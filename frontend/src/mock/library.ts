import type { Claim, Document, Provenance } from '../types'

// Source: the demo Papiers library described in the hackathon brief, 2026-10-16. Mock data, not live.
export const documents: Document[] = [
  { id: 'doc_jordan', title: '94% on CIFAR-10 in 3.29 Seconds on a Single GPU', authors: ['Keller Jordan'], year: 2024, url: 'https://arxiv.org/abs/2404.00498', highlight_count: 6, note_count: 2, papiers_url: 'https://arxiv.org/abs/2404.00498' },
  { id: 'doc_szegedy', title: 'Rethinking the Inception Architecture for Computer Vision', authors: ['Szegedy', 'Vanhoucke', 'Ioffe', 'Shlens', 'Wojna'], year: 2015, url: 'https://arxiv.org/abs/1512.00567', highlight_count: 1, note_count: 1, papiers_url: 'https://arxiv.org/abs/1512.00567' },
  { id: 'doc_muller', title: 'When Does Label Smoothing Help?', authors: ['Müller', 'Kornblith', 'Hinton'], year: 2019, url: 'https://arxiv.org/abs/1906.02629', highlight_count: 1, note_count: 0, papiers_url: 'https://arxiv.org/abs/1906.02629' },
  { id: 'doc_zhang', title: 'mixup: Beyond Empirical Risk Minimization', authors: ['Zhang', 'Cissé', 'Dauphin', 'Lopez-Paz'], year: 2017, url: 'https://arxiv.org/abs/1710.09412', highlight_count: 1, note_count: 1, papiers_url: 'https://arxiv.org/abs/1710.09412' },
  { id: 'doc_he', title: 'Bag of Tricks for Image Classification with CNNs', authors: ['He', 'Zhang', 'Zhang', 'Xie', 'Li'], year: 2018, url: 'https://arxiv.org/abs/1812.01187', highlight_count: 1, note_count: 1, papiers_url: 'https://arxiv.org/abs/1812.01187' },
]
const doc = (id: string) => documents.find((d) => d.id === id)!
const hl = (id: string, doc_id: string, text: string): Provenance => ({ kind: 'highlight', id, doc_id, doc_title: doc(doc_id).title, text, papiers_url: doc(doc_id).url })
const note = (id: string, doc_id: string, text: string): Provenance => ({ kind: 'note', id: `${id}#annotation`, doc_id, doc_title: doc(doc_id).title, text, papiers_url: doc(doc_id).url })

export const P = {
  flip: hl('hl_flip', 'doc_jordan', 'Alternating flip: flip images in a deterministic alternating pattern across epochs, which improves accuracy over random flipping.'),
  flipNote: note('hl_flip', 'doc_jordan', 'Effect is about 0.1 points. Is it real or noise?'),
  tta: hl('hl_tta', 'doc_jordan', 'Multi-crop test-time augmentation evaluates several shifted and mirrored views of each test image.'),
  ttaNote: note('hl_tta', 'doc_jordan', 'How much of the 94% is just test-time augmentation?'),
  ls: hl('hl_ls', 'doc_szegedy', 'Label smoothing with epsilon 0.1 gave about 0.2% improvement on ImageNet.'),
  lsNote: note('hl_ls', 'doc_szegedy', 'Only 0.2% on ImageNet. Still true for 10-epoch CIFAR runs?'),
  lsCal: hl('hl_ls_cal', 'doc_muller', 'Label smoothing improves calibration but impairs distillation.'),
  mix: hl('hl_mix', 'doc_zhang', 'mixup significantly outperforms ERM on CIFAR, with models trained for 200 epochs.'),
  mixNote: note('hl_mix', 'doc_zhang', 'They trained 200 epochs. Does this hold in a 10-epoch run?'),
  bot: hl('hl_bot', 'doc_he', 'Mixup needs more epochs to converge: we increase the number of epochs when using mixup.'),
  botNote: note('hl_bot', 'doc_he', 'Mixup may need long training. Conflicts with short runs.'),
  whiten: hl('hl_whiten', 'doc_jordan', 'Patch-whitening initialization of the first convolution speeds up training substantially.'),
  dirac: hl('hl_dirac', 'doc_jordan', 'Identity (Dirac) initialization of the convolutions after the first improves accuracy.'),
}

const claim = (rank: number, id: string, doc_id: string, summary: string, text: string, prov: Provenance[], conditions: string, annotation?: string, page?: number): Claim =>
  ({ id, rank, weight: 10 - rank, summary, text, doc_id, doc_title: doc(doc_id).title, annotation, conditions, page, provenance: prov })

export const claims: Claim[] = [
  claim(1, 'hl_mix', 'doc_zhang', 'Mixup beats plain training', P.mix.text, [P.mix, P.mixNote], '200 epochs, ResNet-18 / PreAct, CIFAR-10', P.mixNote.text, 4),
  claim(2, 'hl_bot', 'doc_he', 'Mixup needs longer training', P.bot.text, [P.bot, P.botNote], 'ImageNet, ResNet-50, 200 epochs with mixup', P.botNote.text, 8),
  claim(3, 'hl_tta', 'doc_jordan', 'Multi-crop TTA lifts accuracy', P.tta.text, [P.tta, P.ttaNote], 'airbench, 94% target', P.ttaNote.text, 5),
  claim(4, 'hl_flip', 'doc_jordan', 'Alternating flips beat random flips', P.flip.text, [P.flip, P.flipNote], 'airbench, ~10 epochs, CIFAR-10', P.flipNote.text, 3),
  claim(5, 'hl_ls', 'doc_szegedy', 'Label smoothing adds ~0.2%', P.ls.text, [P.ls, P.lsNote], 'ImageNet, Inception-v3, epsilon 0.1', P.lsNote.text, 6),
  claim(6, 'hl_whiten', 'doc_jordan', 'Patch whitening speeds training', P.whiten.text, [P.whiten], 'airbench, CIFAR-10', undefined, 4),
  claim(7, 'hl_dirac', 'doc_jordan', 'Identity init helps deeper convs', P.dirac.text, [P.dirac], 'airbench, CIFAR-10', undefined, 4),
  claim(8, 'hl_ls_cal', 'doc_muller', 'Smoothing helps calibration, not distillation', P.lsCal.text, [P.lsCal], 'Image classification, translation, calibration metrics', undefined, 2),
]
