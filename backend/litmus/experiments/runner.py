"""Client side of the Modal trainer: stream events for (knobs, seeds) from the deployed app."""

from collections.abc import AsyncIterator

import time

import modal

from litmus.modal_app import APP_NAME, CLASS_NAME, SCALEDOWN_SECONDS

_last_activity = 0.0


def is_warm() -> bool:
    """True if we talked to a container recently enough that Modal still keeps it alive."""
    return time.monotonic() - _last_activity < SCALEDOWN_SECONDS


def _trainer():
    return modal.Cls.from_name(APP_NAME, CLASS_NAME)()


async def stream_runs(knobs: dict, seeds: list[int]) -> AsyncIterator[dict]:
    """Yield the trainer's progress/run events as they arrive. Seeds run sequentially on one container."""
    global _last_activity
    async for event in _trainer().train.remote_gen.aio(knobs, seeds):
        _last_activity = time.monotonic()
        yield event


async def ping() -> dict:
    """Start (or touch) a warm container; returns {"ok", "gpu"}."""
    global _last_activity
    result = await _trainer().ping.remote.aio()
    _last_activity = time.monotonic()
    return result
