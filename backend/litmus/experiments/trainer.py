"""Knob-parameterized airbench94 trainer. Runs inside the Modal GPU container.

Derived from Keller Jordan's airbench, legacy/airbench94.py (the paper version: 94.01% mean over
1000 runs, 3.83s on an A100, no torch.compile so there is no autotune warmup).
https://github.com/KellerJordan/cifar10-airbench — MIT License, Copyright (c) 2024 Keller Jordan.
See LICENSE-airbench in this directory.

Changes from upstream: hyperparameters that experiments test are knobs (see knobs.py); added
per-epoch random flip and no-flip modes, cutout, mixup, optional whitening and dirac init,
per-run seeding, and a progress callback. Everything else is upstream.
"""

import os
import time
from math import ceil

import torch
import torch.nn.functional as F
from torch import nn

from litmus.experiments.knobs import normalize_knobs

torch.backends.cudnn.benchmark = True

HYP = {
    "batch_size": 1024,
    "lr": 11.5,  # per 1024 examples
    "momentum": 0.85,
    "weight_decay": 0.0153,  # per 1024 examples, decoupled from lr
    "bias_scaler": 64.0,
    "whiten_bias_epochs": 3,
    "widths": (64, 256, 256),
    "batchnorm_momentum": 0.6,
    "scaling_factor": 1 / 9,
    "whiten_kernel_size": 2,
    "whiten_init_images": 5000,
    "eval_batch_size": 2000,
}

CIFAR_MEAN = torch.tensor((0.4914, 0.4822, 0.4465))
CIFAR_STD = torch.tensor((0.2470, 0.2435, 0.2616))


#############################################
#                   Data                    #
#############################################

def load_cifar(root: str, device: str = "cuda") -> dict:
    """Load CIFAR-10 as normalized fp16 NCHW tensors on `device`.

    Caches train.pt/test.pt next to the tarball; returns whether the cache was created so the
    caller can commit the volume.
    """
    import torchvision  # container-only dependency

    created = False
    out = {}
    for split in ("train", "test"):
        path = os.path.join(root, f"{split}.pt")
        if not os.path.exists(path):
            # download=True only verifies the md5 of the existing tarball and extracts it.
            dset = torchvision.datasets.CIFAR10(root, download=True, train=split == "train")
            torch.save({"images": torch.tensor(dset.data), "labels": torch.tensor(dset.targets)}, path)
            created = True
        data = torch.load(path, map_location=device)
        images = (data["images"].half() / 255).permute(0, 3, 1, 2).to(memory_format=torch.channels_last)
        mean, std = CIFAR_MEAN.to(device).view(1, 3, 1, 1), CIFAR_STD.to(device).view(1, 3, 1, 1)
        out[split] = {"images": ((images - mean) / std).half(), "labels": data["labels"]}
    out["created_cache"] = created
    return out


def batch_flip_lr(inputs):
    flip_mask = (torch.rand(len(inputs), device=inputs.device) < 0.5).view(-1, 1, 1, 1)
    return torch.where(flip_mask, inputs.flip(-1), inputs)


def batch_crop(images, crop_size):
    r = (images.size(-1) - crop_size) // 2
    shifts = torch.randint(-r, r + 1, size=(len(images), 2), device=images.device)
    images_out = torch.empty((len(images), 3, crop_size, crop_size), device=images.device, dtype=images.dtype)
    # The two cropping methods produce equivalent results; the second is faster for r > 2.
    if r <= 2:
        for sy in range(-r, r + 1):
            for sx in range(-r, r + 1):
                mask = (shifts[:, 0] == sy) & (shifts[:, 1] == sx)
                images_out[mask] = images[mask, :, r + sy:r + sy + crop_size, r + sx:r + sx + crop_size]
    else:
        images_tmp = torch.empty((len(images), 3, crop_size, crop_size + 2 * r), device=images.device, dtype=images.dtype)
        for s in range(-r, r + 1):
            mask = shifts[:, 0] == s
            images_tmp[mask] = images[mask, :, r + s:r + s + crop_size, :]
        for s in range(-r, r + 1):
            mask = shifts[:, 1] == s
            images_out[mask] = images_tmp[mask, :, :, r + s:r + s + crop_size]
    return images_out


def batch_cutout(images, size):
    """Zero a size x size square (in normalized space, i.e. the dataset mean) at a random center per image."""
    n, _, h, w = images.shape
    cy = torch.randint(0, h, (n, 1, 1), device=images.device)
    cx = torch.randint(0, w, (n, 1, 1), device=images.device)
    ys = torch.arange(h, device=images.device).view(1, h, 1)
    xs = torch.arange(w, device=images.device).view(1, 1, w)
    top, left = cy - size // 2, cx - size // 2
    mask = (ys >= top) & (ys < top + size) & (xs >= left) & (xs < left + size)
    return images.masked_fill(mask.unsqueeze(1), 0)


def mixup_batch(inputs, labels, alpha):
    """Standard mixup (Zhang et al. 2017): one lam ~ Beta(alpha, alpha) per batch, paired with a shuffled copy.

    Returns (mixed_inputs, labels_a, labels_b, lam). The loss is lam * L(y_a) + (1 - lam) * L(y_b), which
    equals cross-entropy against the mixed soft target, label smoothing included.
    """
    lam = float(torch.distributions.Beta(alpha, alpha).sample())
    perm = torch.randperm(len(inputs), device=inputs.device)
    mixed = lam * inputs + (1 - lam) * inputs[perm]
    return mixed.to(inputs.dtype), labels, labels[perm], lam


class TrainLoader:
    """Upstream CifarLoader minus disk IO; flip is "alternating" (upstream), "random" (fresh each epoch) or "none"."""

    def __init__(self, images, labels, batch_size, flip, translate):
        self.images, self.labels = images, labels
        self.batch_size, self.flip, self.translate = batch_size, flip, translate
        self.epoch = 0
        self.pre_flipped = batch_flip_lr(images) if flip == "alternating" else None
        self.pre_padded = None

    def __len__(self):
        return len(self.images) // self.batch_size

    def __iter__(self):
        if self.flip == "alternating":
            images = self.pre_flipped
            # Flip all images together every other epoch: more diversity than random flipping.
            if self.epoch % 2 == 1:
                images = images.flip(-1)
        elif self.flip == "random":
            images = batch_flip_lr(self.images)
        else:
            images = self.images
        if self.translate > 0:
            images = batch_crop(F.pad(images, (self.translate,) * 4, "reflect"), self.images.shape[-2])
        self.epoch += 1
        indices = torch.randperm(len(images), device=images.device)
        for i in range(len(self)):
            idxs = indices[i * self.batch_size:(i + 1) * self.batch_size]
            yield images[idxs], self.labels[idxs]


#############################################
#                  Network                  #
#############################################

class Flatten(nn.Module):
    def forward(self, x):
        return x.view(x.size(0), -1)


class Mul(nn.Module):
    def __init__(self, scale):
        super().__init__()
        self.scale = scale

    def forward(self, x):
        return x * self.scale


class BatchNorm(nn.BatchNorm2d):
    def __init__(self, num_features, momentum, eps=1e-12, weight=False, bias=True):
        super().__init__(num_features, eps=eps, momentum=1 - momentum)
        self.weight.requires_grad = weight
        self.bias.requires_grad = bias


class Conv(nn.Conv2d):
    def __init__(self, in_channels, out_channels, kernel_size=3, padding="same", bias=False, dirac=True):
        self.dirac = dirac
        super().__init__(in_channels, out_channels, kernel_size=kernel_size, padding=padding, bias=bias)

    def reset_parameters(self):
        super().reset_parameters()
        if self.bias is not None:
            self.bias.data.zero_()
        if self.dirac:
            w = self.weight.data
            torch.nn.init.dirac_(w[:w.size(1)])


class ConvGroup(nn.Module):
    def __init__(self, channels_in, channels_out, batchnorm_momentum, dirac):
        super().__init__()
        self.conv1 = Conv(channels_in, channels_out, dirac=dirac)
        self.pool = nn.MaxPool2d(2)
        self.norm1 = BatchNorm(channels_out, batchnorm_momentum)
        self.conv2 = Conv(channels_out, channels_out, dirac=dirac)
        self.norm2 = BatchNorm(channels_out, batchnorm_momentum)
        self.activ = nn.GELU()

    def forward(self, x):
        x = self.activ(self.norm1(self.pool(self.conv1(x))))
        return self.activ(self.norm2(self.conv2(x)))


def make_net(knobs):
    w1, w2, w3 = HYP["widths"]
    bn = HYP["batchnorm_momentum"]
    k = HYP["whiten_kernel_size"]
    whiten_width = 2 * 3 * k**2
    net = nn.Sequential(
        Conv(3, whiten_width, k, padding=0, bias=True, dirac=False),
        nn.GELU(),
        ConvGroup(whiten_width, w1, bn, knobs["dirac_init"]),
        ConvGroup(w1, w2, bn, knobs["dirac_init"]),
        ConvGroup(w2, w3, bn, knobs["dirac_init"]),
        nn.MaxPool2d(3),
        Flatten(),
        nn.Linear(w3, 10, bias=False),
        Mul(HYP["scaling_factor"]),
    )
    # With whitening the first layer is a frozen data-derived filter bank; without it, a normal trainable conv.
    net[0].weight.requires_grad = not knobs["whiten"]
    net = net.half().cuda().to(memory_format=torch.channels_last)
    for mod in net.modules():
        if isinstance(mod, BatchNorm):
            mod.float()
    return net


def init_whitening_conv(layer, train_set, eps=5e-4):
    h, w = layer.weight.data.shape[2:]
    c = train_set.shape[1]
    patches = train_set.unfold(2, h, 1).unfold(3, w, 1).transpose(1, 3).reshape(-1, c, h, w).float()
    patches_flat = patches.view(len(patches), -1)
    covariance = (patches_flat.T @ patches_flat) / len(patches_flat)
    eigenvalues, eigenvectors = torch.linalg.eigh(covariance, UPLO="U")
    eigenvalues = eigenvalues.flip(0).view(-1, 1, 1, 1)
    eigenvectors = eigenvectors.T.reshape(c * h * w, c, h, w).flip(0)
    scaled = eigenvectors / torch.sqrt(eigenvalues + eps)
    layer.weight.data[:] = torch.cat((scaled, -scaled))


class LookaheadState:
    def __init__(self, net):
        self.net_ema = {k: v.clone() for k, v in net.state_dict().items()}

    def update(self, net, decay):
        for ema_param, net_param in zip(self.net_ema.values(), net.state_dict().values()):
            if net_param.dtype in (torch.half, torch.float):
                ema_param.lerp_(net_param, 1 - decay)
                net_param.copy_(ema_param)


#############################################
#                Evaluation                 #
#############################################

def infer(model, images, tta_level):
    # tta_level 0: plain; 1: average with the mirror; 2: mirror plus one-pixel translations (6 views).
    def infer_mirror(inputs):
        return 0.5 * model(inputs) + 0.5 * model(inputs.flip(-1))

    def infer_mirror_translate(inputs):
        logits = infer_mirror(inputs)
        padded = F.pad(inputs, (1,) * 4, "reflect")
        translated = [infer_mirror(padded[:, :, 0:32, 0:32]), infer_mirror(padded[:, :, 2:34, 2:34])]
        return 0.5 * logits + 0.5 * torch.stack(translated).mean(0)

    infer_fn = [lambda x: model(x).clone(), infer_mirror, infer_mirror_translate][tta_level]
    model.eval()
    with torch.no_grad():
        return torch.cat([infer_fn(batch) for batch in images.split(HYP["eval_batch_size"])])


def evaluate(model, split, tta_level):
    return (infer(model, split["images"], tta_level).argmax(1) == split["labels"]).float().mean().item()


#############################################
#                 Training                  #
#############################################

def train_run(knobs: dict, seed: int, data: dict):
    """Train one airbench94 model with `knobs` and `seed`, yielding events as they happen.

    Yields {"type": "progress", seed, epoch, train_acc, val_acc} after each epoch (val_acc without TTA),
    then {"type": "run", seed, val_acc, tta_val_acc, time_seconds}. tta_val_acc is the final accuracy at
    the config's own tta_level (equal to val_acc when tta_level=0).
    """
    knobs = normalize_knobs(knobs)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    started = time.perf_counter()

    batch_size = HYP["batch_size"]
    epochs = knobs["epochs"]
    momentum = HYP["momentum"]
    # Nesterov steps are (1 + 1/(1-momentum)) times the gradient; divide it out so lr is decoupled.
    kilostep_scale = 1024 * (1 + 1 / (1 - momentum))
    lr = HYP["lr"] * knobs["lr_scale"] / kilostep_scale
    wd = HYP["weight_decay"] * batch_size / kilostep_scale
    lr_biases = lr * HYP["bias_scaler"]

    loss_fn = nn.CrossEntropyLoss(label_smoothing=knobs["label_smoothing"], reduction="none")
    train = data["train"]
    loader = TrainLoader(train["images"], train["labels"], batch_size, knobs["flip"], knobs["translate"])
    total_train_steps = ceil(len(loader) * epochs)

    model = make_net(knobs)
    norm_biases = [p for k, p in model.named_parameters() if "norm" in k and p.requires_grad]
    other_params = [p for k, p in model.named_parameters() if "norm" not in k and p.requires_grad]
    optimizer = torch.optim.SGD(
        [dict(params=norm_biases, lr=lr_biases, weight_decay=wd / lr_biases),
         dict(params=other_params, lr=lr, weight_decay=wd / lr)],
        momentum=momentum, nesterov=True,
    )

    def get_lr(step):
        warmup_steps = int(total_train_steps * 0.23)
        if step < warmup_steps:
            frac = step / warmup_steps
            return 0.2 * (1 - frac) + 1.0 * frac
        frac = (step - warmup_steps) / (total_train_steps - warmup_steps)
        return 1.0 * (1 - frac) + 0.07 * frac

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, get_lr)
    alpha_schedule = 0.95**5 * (torch.arange(total_train_steps + 1) / total_train_steps) ** 3
    lookahead_state = LookaheadState(model)

    if knobs["whiten"]:
        init_whitening_conv(model[0], train["images"][:HYP["whiten_init_images"]])

    current_steps = 0
    val_acc = 0.0
    for epoch in range(ceil(epochs)):
        model[0].bias.requires_grad = epoch < HYP["whiten_bias_epochs"]
        model.train()
        for inputs, labels in loader:
            if knobs["cutout"] > 0:
                inputs = batch_cutout(inputs, knobs["cutout"])
            if knobs["mixup_alpha"] > 0:
                inputs, labels_a, labels_b, lam = mixup_batch(inputs, labels, knobs["mixup_alpha"])
                outputs = model(inputs)
                loss = (lam * loss_fn(outputs, labels_a) + (1 - lam) * loss_fn(outputs, labels_b)).sum()
            else:
                outputs = model(inputs)
                loss = loss_fn(outputs, labels).sum()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            scheduler.step()
            current_steps += 1
            if current_steps % 5 == 0:
                lookahead_state.update(model, decay=alpha_schedule[current_steps].item())
            if current_steps >= total_train_steps:
                lookahead_state.update(model, decay=1.0)
                break

        train_acc = (outputs.detach().argmax(1) == labels).float().mean().item()
        val_acc = evaluate(model, data["test"], tta_level=0)
        yield {"type": "progress", "seed": seed, "epoch": epoch + 1, "train_acc": train_acc, "val_acc": val_acc}

    tta_val_acc = evaluate(model, data["test"], tta_level=knobs["tta_level"])
    torch.cuda.synchronize()
    yield {"type": "run", "seed": seed, "val_acc": val_acc, "tta_val_acc": tta_val_acc,
            "time_seconds": round(time.perf_counter() - started, 3)}
