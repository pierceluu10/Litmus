"""OpenAI structured-output calls. Prompts live in prompts/<name>.txt with $placeholders (string.Template).

The LLM only ever reads numbers the grader produced; it never produces them.
"""

import json
from pathlib import Path
from string import Template
from typing import TypeVar

from openai import APIError, AsyncOpenAI
from pydantic import BaseModel, ValidationError

from litmus.config import openai_model

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
SDK_RETRIES = 3  # the SDK retries rate limits and 5xx with exponential backoff

Schema = TypeVar("Schema", bound=BaseModel)
_client: AsyncOpenAI | None = None


class LLMError(RuntimeError):
    """The model failed to return a valid structured response after one repair attempt."""


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(max_retries=SDK_RETRIES)
    return _client


def render(prompt_name: str, **values) -> str:
    text = (PROMPTS_DIR / f"{prompt_name}.txt").read_text()
    return Template(text).substitute({k: v if isinstance(v, str) else json.dumps(v, indent=1, default=str)
                                      for k, v in values.items()})


async def structured(prompt_name: str, schema: type[Schema], **values) -> Schema:
    """Render the prompt, ask for `schema`, and on a schema failure repair once with the error attached."""
    prompt = render(prompt_name, **values)
    last_error: Exception | None = None
    for attempt in range(2):
        content = prompt if attempt == 0 else (
            f"{prompt}\n\nYour previous answer was invalid: {last_error}\nReturn a corrected answer.")
        try:
            response = await client().responses.parse(model=openai_model(), input=content, text_format=schema)
            if response.output_parsed is None:
                raise LLMError("model returned no parsed output (refusal or empty)")
            return response.output_parsed
        except (ValidationError, LLMError, json.JSONDecodeError) as error:
            last_error = error
        except APIError as error:
            raise LLMError(f"{prompt_name}: OpenAI API error: {error}") from error
    raise LLMError(f"{prompt_name}: invalid structured output after repair: {last_error}")


async def ok() -> bool:
    try:
        await client().models.retrieve(openai_model())
        return True
    except (APIError, RuntimeError):
        return False
