"""`uv run litmus <command>` — entry points for the human."""

import argparse
import asyncio
import time

from dotenv import load_dotenv


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


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(prog="litmus")
    commands = parser.add_subparsers(dest="command", required=True)
    smoke = commands.add_parser("smoke", help="train the baseline on Modal and stream epochs")
    smoke.add_argument("--seeds", type=int, nargs="+", default=[0])
    commands.add_parser("warmup", help="start a warm Modal container (run ~2 min before judging)")
    args = parser.parse_args()

    if args.command == "smoke":
        asyncio.run(_smoke(args.seeds))
    elif args.command == "warmup":
        asyncio.run(_warmup())
