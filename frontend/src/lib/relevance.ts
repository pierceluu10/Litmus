import type { Claim } from '../types'

// Which highlights are about what you are researching: plain word matching, no AI. Words match on their first STEM
// letters, so "training" finds "train" and "optimization" finds "optimizer"; filler words in the topic are ignored.
const STEM = 5
const COMMON = 0.75 // a word in more than this share of the highlights is too common to filter on
const FILLER = new Set(['the', 'and', 'for', 'with', 'about', 'into', 'from', 'that', 'this', 'how', 'what', 'why', 'doing', 'research', 'researching', 'study', 'studying', 'work', 'working', 'on', 'in', 'of', 'to', 'a', 'an', 'my', 'i', 'im', 'is', 'are'])

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const stem = (word: string) => word.slice(0, STEM)

export function topicStems(topic: string): string[] {
  return [...new Set(words(topic).filter((w) => !FILLER.has(w) && (w.length > 2 || /^\d+$/.test(w))).map(stem))]
}

// The claims about the topic, best matches first (then the library's own order); none when the topic is empty.
// A topic word that nearly every highlight mentions ("training" in a training library) cannot tell highlights apart: a
// highlight counts if it mentions a distinctive topic word, or, when the topic is mostly such common words (the library
// is about it as a whole), if it mentions all of them.
export function relevant(claims: Claim[], topic: string): Claim[] {
  const topicWords = topicStems(topic)
  if (!topicWords.length) return []
  const seen = claims.map((c) => new Set(words([c.summary, c.text, c.annotation, c.doc_title, c.conditions].filter(Boolean).join(' ')).map(stem)))
  const common = topicWords.filter((w) => seen.filter((s) => s.has(w)).length > claims.length * COMMON)
  const specific = topicWords.filter((w) => !common.includes(w))
  const broad = common.length * 2 > topicWords.length
  return claims
    .map((c, i) => {
      const hits = specific.filter((w) => seen[i].has(w)).length
      const all = common.every((w) => seen[i].has(w))
      return { c, keep: hits > 0 || (broad && all), score: hits * topicWords.length + common.filter((w) => seen[i].has(w)).length }
    })
    .filter((x) => x.keep)
    .sort((a, b) => b.score - a.score || a.c.rank - b.c.rank)
    .map((x) => x.c)
}
