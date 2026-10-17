"""Modal app "litmus": runs knob-configured airbench94 trainings on an A100.

Deploy: `uv run modal deploy litmus/modal_app.py` (from backend/). The server looks the class up by name,
so image builds never happen on the demo path.
"""

import modal

APP_NAME = "litmus"
CLASS_NAME = "Trainer"
DATA_DIR = "/data"
# Starter plan caps us at 10 concurrent GPUs: 4 branches + shadows fit comfortably under 8.
MAX_CONTAINERS = 8
# Keep a container warm for 10 minutes after the last call so a demo never pays a cold start twice.
SCALEDOWN_SECONDS = 600
TIMEOUT_SECONDS = 1800

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch", "torchvision")
    .add_local_python_source("litmus")
)
app = modal.App(APP_NAME, image=image)
volume = modal.Volume.from_name("cifar-data")


@app.cls(gpu="A100", volumes={DATA_DIR: volume}, timeout=TIMEOUT_SECONDS,
         scaledown_window=SCALEDOWN_SECONDS, max_containers=MAX_CONTAINERS)
class Trainer:
    @modal.enter()
    def load(self):
        from litmus.experiments.knobs import BASELINE_KNOBS
        from litmus.experiments.trainer import load_cifar, train_run

        self.data = load_cifar(DATA_DIR)
        if self.data["created_cache"]:
            volume.commit()
        # One short throwaway run so cudnn autotuning is paid at container start, not inside a measured run.
        for _ in train_run({**BASELINE_KNOBS, "epochs": 1}, seed=0, data=self.data):
            pass

    @modal.method()
    def ping(self) -> dict:
        import torch

        return {"ok": True, "gpu": torch.cuda.get_device_name()}

    @modal.method()
    def train(self, knobs: dict, seeds: list[int]):
        """Run seeds sequentially, streaming every progress and run event from trainer.train_run."""
        from litmus.experiments.trainer import train_run

        for seed in seeds:
            yield from train_run(knobs, seed, self.data)
