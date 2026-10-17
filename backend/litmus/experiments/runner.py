"""Client side of the Modal trainer: stream events for (knobs, seeds) from the deployed app."""

from collections.abc import AsyncIterator

import modal

from litmus.modal_app import APP_NAME, CLASS_NAME


def _trainer():
    return modal.Cls.from_name(APP_NAME, CLASS_NAME)()


async def stream_runs(knobs: dict, seeds: list[int]) -> AsyncIterator[dict]:
    """Yield the trainer's progress/run events as they arrive. Seeds run sequentially on one container."""
    async for event in _trainer().train.remote_gen.aio(knobs, seeds):
        yield event


async def ping() -> dict:
    """Start (or touch) a warm container; returns {"ok", "gpu"}."""
    return await _trainer().ping.remote.aio()
