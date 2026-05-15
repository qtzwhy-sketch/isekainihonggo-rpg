import type { VocabularyItem } from '../data/vocabulary'

export type QuestionKind = 'reading' | 'meaning' | 'kanji'

export interface GeneratedQuestion {
  type: QuestionKind
  prompt: string
  options: string[]
  /** 打乱后正确答案在 `options` 中的下标 */
  correctIndex: number
  /** 正确答案文案，与选项中正确项全等比较 */
  answer: string
  /** 本题对应词条 id，用于错题学习反馈 */
  targetId: number
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

function pickRandomItem(items: VocabularyItem[]): VocabularyItem {
  return items[Math.floor(Math.random() * items.length)]
}

function pickRandomKind(): QuestionKind {
  const kinds: QuestionKind[] = ['reading', 'meaning', 'kanji']
  return kinds[Math.floor(Math.random() * kinds.length)]
}

function pickWrongOptions(
  items: VocabularyItem[],
  target: VocabularyItem,
  field: 'reading' | 'meaning' | 'word',
  count: number
): string[] {
  const correct = target[field]
  const pool = items
    .filter((v) => v.id !== target.id)
    .map((v) => v[field])
    .filter((s) => s !== correct)

  const seen = new Set<string>()
  const unique: string[] = []
  shuffleInPlace(pool)
  for (const s of pool) {
    if (seen.has(s)) continue
    seen.add(s)
    unique.push(s)
    if (unique.length >= count) break
  }
  return unique.slice(0, count)
}

function buildOptionsWithShuffle(correct: string, wrong: string[]): { options: string[]; correctIndex: number } {
  const options = [correct, ...wrong]
  shuffleInPlace(options)
  const correctIndex = options.indexOf(correct)
  return { options, correctIndex }
}

export type GenerateQuestionOptions = {
  /** 指定本题考查的词条；不传则从全库随机 */
  target?: VocabularyItem
}

/**
 * 基于给定 `vocabulary` 随机生成一道四选题（读音 / 意思 / 汉字三选一题型）。
 * 可通过 `opts.target` 固定考查某词（用于错题复仇等），错题项仍从全库抽取。
 */
export function generateQuestion(vocabulary: VocabularyItem[], opts?: GenerateQuestionOptions): GeneratedQuestion {
  if (vocabulary.length < 4) {
    throw new Error('vocabulary 至少需要 4 条记录才能生成四选一题目')
  }

  const target = opts?.target ?? pickRandomItem(vocabulary)
  const kind = pickRandomKind()
  const field = fieldForKind(kind)
  const correctStr = target[field]

  let wrong = pickWrongOptions(vocabulary, target, field, 3)
  if (wrong.length < 3) {
    const rest = vocabulary
      .filter((v) => v.id !== target.id)
      .map((v) => v[field])
    for (const s of rest) {
      if (s === correctStr || wrong.includes(s)) continue
      wrong.push(s)
      if (wrong.length >= 3) break
    }
  }
  wrong = wrong.slice(0, 3)

  const { options, correctIndex } = buildOptionsWithShuffle(correctStr, wrong)
  const prompt = buildPrompt(kind, target)

  return { type: kind, prompt, options, correctIndex, answer: correctStr, targetId: target.id }
}

function fieldForKind(kind: QuestionKind): 'reading' | 'meaning' | 'word' {
  switch (kind) {
    case 'reading':
      return 'reading'
    case 'meaning':
      return 'meaning'
    case 'kanji':
      return 'word'
  }
}

function buildPrompt(kind: QuestionKind, target: VocabularyItem): string {
  switch (kind) {
    case 'reading':
      return `「${target.word}」的读音是？`
    case 'meaning':
      return `「${target.word}」的意思是？`
    case 'kanji':
      return `读音为「${target.reading}」的汉字是？`
  }
}
