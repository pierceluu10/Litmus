"""CPU checks for the augmentations we added to airbench (mixup, cutout, flip modes) and knob hashing."""

import torch

from litmus.experiments.knobs import BASELINE_KNOBS, config_hash, normalize_knobs
from litmus.experiments.trainer import TrainLoader, batch_cutout, mixup_batch


def test_mixup_is_convex_combination_of_batch_and_its_permutation():
    torch.manual_seed(0)
    inputs = torch.randn(8, 3, 4, 4)
    labels = torch.arange(8)
    mixed, labels_a, labels_b, lam = mixup_batch(inputs, labels, alpha=0.4)
    assert 0.0 <= lam <= 1.0
    assert torch.equal(labels_a, labels)
    assert sorted(labels_b.tolist()) == labels.tolist()  # a permutation of the batch
    # Each mixed row equals lam * x_i + (1 - lam) * x_perm(i), where perm(i) is recovered from labels_b.
    expected = lam * inputs + (1 - lam) * inputs[labels_b]
    assert torch.allclose(mixed, expected, atol=1e-6), (mixed - expected).abs().max()


def test_mixup_loss_equals_soft_target_cross_entropy_with_label_smoothing():
    torch.manual_seed(1)
    logits = torch.randn(6, 10)
    labels_a, labels_b, lam, eps = torch.tensor([0, 1, 2, 3, 4, 5]), torch.tensor([5, 4, 3, 2, 1, 0]), 0.3, 0.2
    loss_fn = torch.nn.CrossEntropyLoss(label_smoothing=eps, reduction="none")
    ours = lam * loss_fn(logits, labels_a) + (1 - lam) * loss_fn(logits, labels_b)

    def smooth(y):
        return torch.nn.functional.one_hot(y, 10).float() * (1 - eps) + eps / 10

    soft = lam * smooth(labels_a) + (1 - lam) * smooth(labels_b)
    reference = -(soft * torch.log_softmax(logits, 1)).sum(1)
    assert torch.allclose(ours, reference, atol=1e-5)


def test_cutout_zeroes_exactly_one_square_per_image_inside_bounds():
    torch.manual_seed(2)
    images = torch.ones(16, 3, 32, 32)
    out = batch_cutout(images, size=8)
    zeroed = (out == 0).all(1)  # same mask on every channel
    for mask in zeroed:
        rows, cols = mask.any(1).nonzero().flatten(), mask.any(0).nonzero().flatten()
        assert 1 <= len(rows) <= 8 and 1 <= len(cols) <= 8  # clipped at the border, never larger
        assert mask.sum() == len(rows) * len(cols)  # a solid rectangle
    assert (out[:, 0] == 0).sum() > 0


def test_flip_modes():
    torch.manual_seed(3)
    images = torch.randn(10, 3, 4, 4)
    labels = torch.arange(10)

    def epoch_images(loader):
        batches = list(loader)
        order = torch.cat([y for _, y in batches])
        stacked = torch.cat([x for x, _ in batches])
        return stacked[order.argsort()]

    none = TrainLoader(images, labels, batch_size=5, flip="none", translate=0)
    assert torch.equal(epoch_images(none), images)

    alternating = TrainLoader(images, labels, batch_size=5, flip="alternating", translate=0)
    first, second = epoch_images(alternating), epoch_images(alternating)
    assert torch.equal(second, first.flip(-1))  # every image flips together on odd epochs

    translated = TrainLoader(images, labels, batch_size=5, flip="random", translate=1)
    assert epoch_images(translated).shape == images.shape


def test_config_hash_is_type_insensitive_and_change_sensitive():
    assert config_hash(BASELINE_KNOBS) == config_hash({**BASELINE_KNOBS, "epochs": 9.9, "cutout": 0.0})
    assert config_hash({**BASELINE_KNOBS, "epochs": 20}) == config_hash({**BASELINE_KNOBS, "epochs": 20.0})
    assert config_hash(BASELINE_KNOBS) != config_hash({**BASELINE_KNOBS, "mixup_alpha": 0.2})
    assert normalize_knobs({"tta_level": 0})["tta_level"] == 0
