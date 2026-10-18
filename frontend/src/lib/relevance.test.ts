import { describe, expect, it } from 'vitest'
import type { Claim } from '../types'
import { relevant, topicStems } from './relevance'

const claim = (id: string, rank: number, text: string, extra: Partial<Claim> = {}): Claim =>
  ({ id, rank, text, doc_id: 'd', doc_title: '', weight: 1, provenance: [], ...extra })

describe('relevance', () => {
  it('drops filler words and keeps numbers', () => {
    expect(topicStems("I'm doing CIFAR-10 training optimization")).toEqual(['cifar', '10', 'train', 'optim'])
  })

  it('matches word forms and ranks by how many topic words a claim mentions', () => {
    const claims = [
      claim('flip', 1, 'Alternating flips beat random flips.', { doc_title: '94% on CIFAR-10 in 3.29 Seconds' }),
      claim('nlp', 2, 'Transformers need warmup for translation.'),
      claim('mix', 3, 'Mixup needs longer training to pay off on CIFAR-10.', { annotation: 'Check the optimizer too' }),
    ]
    expect(relevant(claims, 'CIFAR 10 training optimization').map((c) => c.id)).toEqual(['mix', 'flip'])
  })

  it('ignores a topic word that nearly every highlight mentions', () => {
    const claims = ['Mixup helps training.', 'Longer training helps.', 'Label smoothing helps training.', 'Flips help training.'].map((t, i) => claim(`c${i}`, i, t))
    expect(relevant(claims, 'mixup training').map((c) => c.id)).toEqual(['c0'])
    expect(relevant(claims, 'training').length).toBe(4)
  })

  it('keeps a whole on-topic library when the topic is mostly what every highlight is about', () => {
    const cifar = { doc_title: '94% on CIFAR-10 in 3.29 Seconds' }
    const claims = [
      claim('flip', 1, 'Alternating flips help training.', cifar),
      claim('mix', 2, 'Mixup needs longer training.', cifar),
      claim('opt', 3, 'A better optimizer speeds training.', cifar),
      claim('ls', 4, 'Label smoothing helps training.', cifar),
      claim('nlp', 5, 'Transformers need warmup for translation training.'),
    ]
    expect(relevant(claims, 'CIFAR-10 training optimization').map((c) => c.id)).toEqual(['opt', 'flip', 'mix', 'ls'])
  })

  it('finds nothing for an empty or all-filler topic', () => {
    expect(relevant([claim('a', 1, 'anything')], '  the research of ')).toEqual([])
  })
})
