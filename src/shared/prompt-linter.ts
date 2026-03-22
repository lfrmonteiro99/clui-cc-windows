/**
 * Prompt Sharpener — local heuristic analysis of user prompts before sending.
 * Detects ambiguous scope, multi-task prompts, vague pronouns, and overly broad scope.
 * All checks are local (no AI), lightweight, and designed to minimize false positives.
 */

export interface PromptLintWarning {
  id: string
  severity: 'info' | 'warning'
  message: string
  suggestion?: string
}

// ─── File extension pattern (common source files) ───

const FILE_EXT_PATTERN = /\.\w{1,5}\b/

// ─── Rule: ambiguous-scope ───
// Short prompt containing "fix/change/update/refactor this" without a file reference

const AMBIGUOUS_VERBS = /\b(fix|change|update|refactor|modify|edit)\s+this\b/i

function checkAmbiguousScope(text: string): PromptLintWarning | null {
  if (text.length >= 80) return null
  if (!AMBIGUOUS_VERBS.test(text)) return null
  if (FILE_EXT_PATTERN.test(text)) return null
  return {
    id: 'ambiguous-scope',
    severity: 'warning',
    message: 'Ambiguous reference — which file or code?',
    suggestion: 'Try specifying a filename or code snippet.',
  }
}

// ─── Rule: multi-task ───
// Detects "and also", "and then", "plus ", or 3+ imperative verbs

const MULTI_TASK_CONNECTORS = /\band\s+also\b|\band\s+then\b|\bplus\s+/i

const IMPERATIVE_VERBS = [
  'fix', 'add', 'update', 'remove', 'refactor', 'change',
  'create', 'delete', 'move', 'rename', 'implement', 'write',
  'install', 'migrate', 'convert', 'replace',
]

const IMPERATIVE_PATTERN = new RegExp(
  `\\b(${IMPERATIVE_VERBS.join('|')})\\b`,
  'gi',
)

function checkMultiTask(text: string): PromptLintWarning | null {
  if (MULTI_TASK_CONNECTORS.test(text)) {
    return {
      id: 'multi-task',
      severity: 'info',
      message: 'Multiple tasks detected — consider splitting into separate prompts.',
      suggestion: 'Claude works best when focused on one task at a time.',
    }
  }
  const matches = text.match(IMPERATIVE_PATTERN)
  if (matches && matches.length >= 3) {
    return {
      id: 'multi-task',
      severity: 'info',
      message: 'Multiple tasks detected — consider splitting into separate prompts.',
      suggestion: 'Claude works best when focused on one task at a time.',
    }
  }
  return null
}

// ─── Rule: vague-pronouns ───
// Short prompt starting with vague patterns like "do it", "fix it", "make it work"

const VAGUE_PATTERNS = /^(do\s+it|change\s+it|fix\s+it|make\s+it\s+work|make\s+it\s+better|update\s+it|run\s+it|just\s+do\s+it)\b/i

function checkVaguePronouns(text: string): PromptLintWarning | null {
  if (text.length >= 80) return null
  if (!VAGUE_PATTERNS.test(text.trim())) return null
  return {
    id: 'vague-pronouns',
    severity: 'warning',
    message: 'Vague pronoun — what does "it" refer to?',
    suggestion: 'Try describing the specific file, function, or behavior.',
  }
}

// ─── Rule: broad-scope ───
// Contains phrases implying the entire project

const BROAD_SCOPE_PATTERNS = /\b(all\s+files|entire\s+project|everything|whole\s+codebase|every\s+file|all\s+the\s+files|across\s+the\s+entire)\b/i

function checkBroadScope(text: string): PromptLintWarning | null {
  if (!BROAD_SCOPE_PATTERNS.test(text)) return null
  return {
    id: 'broad-scope',
    severity: 'warning',
    message: 'Very broad scope — this may produce a large, slow response.',
    suggestion: 'Consider narrowing to a specific directory or file pattern.',
  }
}

// ─── Main linter ───

const rules = [
  checkAmbiguousScope,
  checkMultiTask,
  checkVaguePronouns,
  checkBroadScope,
]

export function lintPrompt(text: string): PromptLintWarning[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  // Skip linting for slash commands
  if (trimmed.startsWith('/')) return []

  const warnings: PromptLintWarning[] = []
  for (const rule of rules) {
    const warning = rule(trimmed)
    if (warning) warnings.push(warning)
  }
  return warnings
}
