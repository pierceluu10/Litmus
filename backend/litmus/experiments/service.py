"""Run a knob config over seeds: cache first, then Modal, with one automatic retry for the missing seeds."""

from collections.abc import Callable

import modal.exception

from litmus import store
from litmus.experiments.knobs import config_hash, normalize_knobs
from litmus.experiments.runner import stream_runs

MODAL_RETRIES = 1
GPU_SECONDS_PER_EPOCH_SEED = 0.45  # measured: 4.2 GPU-s for 9.9 epochs; used only for budget estimates


class ExperimentError(RuntimeError):
    """Modal failed for a config even after the retry."""


def estimate_gpu_seconds(knobs: dict, n_seeds: int) -> float:
    return normalize_knobs(knobs)["epochs"] * GPU_SECONDS_PER_EPOCH_SEED * n_seeds


async def run_config(knobs: dict, seeds: list[int], on_event: Callable[[dict], None]) -> list[dict]:
    """RunResult dicts in seed order. on_event gets every progress/run event; cached runs carry cached=True."""
    knobs = normalize_knobs(knobs)
    key = config_hash(knobs)
    results: dict[int, dict] = {}
    for seed in seeds:
        hit = store.cached_result(key, seed)
        if hit:
            results[seed] = {**hit, "cached": True}
            on_event({"type": "run", **results[seed]})

    failures = 0
    while missing := [s for s in seeds if s not in results]:
        try:
            async for event in stream_runs(knobs, missing):
                if event["type"] == "run":
                    run = {k: v for k, v in event.items() if k != "type"}
                    store.cache_result(key, run["seed"], knobs, run)
                    results[run["seed"]] = run
                on_event(event)
            if any(s not in results for s in missing):
                raise ExperimentError(f"Modal stream ended before seeds {[s for s in missing if s not in results]}")
        except (modal.exception.Error, ConnectionError, TimeoutError, ExperimentError) as error:
            failures += 1
            if failures > MODAL_RETRIES:
                raise ExperimentError(f"training failed after {failures} attempts: {error}") from error
    return [results[s] for s in seeds]
