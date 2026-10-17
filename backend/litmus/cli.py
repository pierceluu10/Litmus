"""`uv run litmus <command>` — entry points for the human."""

import argparse
import asyncio
import time

import litmus.config  # noqa: F401  (loads .env)


async def _smoke(seeds: list[int]) -> None:
    from litmus.experiments.knobs import BASELINE_KNOBS
    from litmus.experiments.runner import stream_runs

    started = time.perf_counter()
    async for event in stream_runs(BASELINE_KNOBS, seeds):
        elapsed = time.perf_counter() - started
        if event["type"] == "progress":
            print(f"[{elapsed:6.1f}s] seed {event['seed']} epoch {event['epoch']:>2}  "
                  f"train_acc {event['train_acc']:.4f}  val_acc {event['val_acc']:.4f}")
        else:
            print(f"[{elapsed:6.1f}s] seed {event['seed']} DONE  val_acc {event['val_acc']:.4f}  "
                  f"tta_val_acc {event['tta_val_acc']:.4f}  gpu {event['time_seconds']:.2f}s")


async def _warmup() -> None:
    from litmus.experiments.runner import ping

    started = time.perf_counter()
    result = await ping()
    print(f"warm: {result} in {time.perf_counter() - started:.1f}s")


async def _library(refresh: bool) -> None:
    from litmus.library import get_library

    documents, claims = await get_library(refresh=refresh)
    print(f"{len(documents)} documents, {len(claims)} claims (judgment-weighted)\n")
    for claim in claims:
        print(f"#{claim.rank:<2} w={claim.weight:<4} [{claim.id}] {claim.doc_title[:50]}")
        print(f"     claim: {claim.text[:160]}")
        if claim.annotation:
            print(f"     NOTE:  {claim.annotation}")
        if claim.conditions:
            print(f"     cond:  {claim.conditions[:300]}")
        print()


def main() -> None:
    parser = argparse.ArgumentParser(prog="litmus")
    commands = parser.add_subparsers(dest="command", required=True)
    smoke = commands.add_parser("smoke", help="train the baseline on Modal and stream epochs")
    smoke.add_argument("--seeds", type=int, nargs="+", default=[0])
    commands.add_parser("warmup", help="start a warm Modal container (run ~2 min before judging)")
    library = commands.add_parser("library", help="print the ranked claims from your Papiers library")
    library.add_argument("--refresh", action="store_true", help="re-read Papiers (otherwise use the cache)")
    args = parser.parse_args()

    if args.command == "smoke":
        asyncio.run(_smoke(args.seeds))
    elif args.command == "warmup":
        asyncio.run(_warmup())
    elif args.command == "library":
        asyncio.run(_library(args.refresh))
