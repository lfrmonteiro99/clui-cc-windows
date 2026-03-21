// ─── Prompt Complexity Classifier ───
// Heuristic scorer that determines which model is most cost-effective for a prompt.
// Score 0-30 → Haiku, 31-65 → Sonnet, 66-100 → Opus

export interface PromptContext {
  messageCount?: number
  toolCallCount?: number
  attachmentCount?: number
}

export interface ClassifierThresholds {
  haiku: number   // max score for Haiku (default 30)
  sonnet: number  // max score for Sonnet (default 65)
}

export interface PromptClassification {
  score: number
  suggestedModel: string
  signals: {
    lengthScore: number
    keywordScore: number
    scopeScore: number
    contextScore: number
  }
}

// ─── Keyword patterns ───

const SIMPLE_KEYWORDS = /\b(explain|what is|what are|how to|list|describe|define|format|summarize|translate|convert|show me|tell me|difference between)\b/i
const MEDIUM_KEYWORDS = /\b(fix|update|add|create|write|implement|modify|change|remove|delete|tests?|refactor|reviews?|improvements?|improve|optimize|migrate|handle|debug|build)\b/i
const COMPLEX_KEYWORDS = /\b(architect|design (?:a |the |new )?(?:system|pattern|layer|architecture)|across the|all (?:files|modules|services|endpoints|controllers)|comprehensive|distributed|microservice|end.to.end|integration test|security audit|performance analysis|race condition|role.based|OAuth|multiple (?:worker|service|node|repo))/i
const SCOPE_BROAD = /\b(entire|whole|all files|every|across|throughout|codebase|project-wide|every module|every endpoint)\b/i
const FILE_MENTION = /\b[\w/-]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|css|html|json|yaml|yml|md|sql)\b/i

// ─── Scoring functions ───

function scoreLengthSignal(prompt: string): number {
  const words = prompt.split(/\s+/).filter(Boolean).length
  if (words <= 10) return 0
  if (words <= 30) return 5
  if (words <= 60) return 15
  if (words <= 100) return 25
  return Math.min(35, 25 + Math.floor((words - 100) / 20))
}

function scoreKeywordSignal(prompt: string): number {
  let score = 0
  const lower = prompt.toLowerCase()

  if (SIMPLE_KEYWORDS.test(lower)) score -= 10
  if (MEDIUM_KEYWORDS.test(lower)) score += 25

  // Count medium keyword matches — more verbs = more complexity
  const uniqueVerbs = new Set(lower.match(new RegExp(MEDIUM_KEYWORDS.source, 'gi')) || [])
  if (uniqueVerbs.size >= 2) score += 10
  if (uniqueVerbs.size >= 3) score += 10
  if (uniqueVerbs.size >= 5) score += 10

  if (COMPLEX_KEYWORDS.test(lower)) score += 30

  // Multiple complex keywords compound
  const complexMatches = lower.match(new RegExp(COMPLEX_KEYWORDS.source, 'gi'))
  if (complexMatches && complexMatches.length >= 2) score += 15

  return score
}

function scoreScopeSignal(prompt: string): number {
  let score = 0
  if (SCOPE_BROAD.test(prompt)) score += 20
  if (FILE_MENTION.test(prompt)) score += 10  // specific file = some complexity
  // Multiple file mentions
  const fileMatches = prompt.match(new RegExp(FILE_MENTION.source, 'gi'))
  if (fileMatches && fileMatches.length >= 3) score += 10
  return score
}

function scoreContextSignal(ctx: PromptContext): number {
  let score = 0
  if (ctx.messageCount && ctx.messageCount > 10) score += Math.min(15, Math.floor(ctx.messageCount / 3))
  if (ctx.toolCallCount && ctx.toolCallCount > 5) score += Math.min(15, Math.floor(ctx.toolCallCount / 2))
  if (ctx.attachmentCount && ctx.attachmentCount > 0) score += Math.min(10, ctx.attachmentCount * 3)
  return score
}

// ─── Main classifier ───

const DEFAULT_THRESHOLDS: ClassifierThresholds = { haiku: 30, sonnet: 65 }

export function classifyPrompt(
  prompt: string,
  context: PromptContext = {},
  thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
): PromptClassification {
  const lengthScore = scoreLengthSignal(prompt)
  const keywordScore = scoreKeywordSignal(prompt)
  const scopeScore = scoreScopeSignal(prompt)
  const contextScore = scoreContextSignal(context)

  const rawScore = lengthScore + keywordScore + scopeScore + contextScore
  const score = Math.max(0, Math.min(100, rawScore))

  let suggestedModel: string
  if (score <= thresholds.haiku) {
    suggestedModel = 'claude-haiku-4-5-20251001'
  } else if (score <= thresholds.sonnet) {
    suggestedModel = 'claude-sonnet-4-6'
  } else {
    suggestedModel = 'claude-opus-4-6'
  }

  return {
    score,
    suggestedModel,
    signals: { lengthScore, keywordScore, scopeScore, contextScore },
  }
}
