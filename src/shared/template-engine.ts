// ─── Smart Prompt Templates with Slots ───

export interface TemplateSlot {
  name: string              // Slot name (e.g., "FILE", "DESCRIPTION")
  index: number             // Position in template string (start)
  length: number            // Length of placeholder including brackets
  defaultValue?: string
}

export interface ParsedTemplate {
  raw: string
  slots: TemplateSlot[]
  variables: string[]       // System variables found (git.branch, etc.)
}

const SLOT_PATTERN = /\[([A-Z][A-Z0-9_]*)\]/g
const VARIABLE_PATTERN = /\{\{([a-z][a-z0-9_.]*)\}\}/g

/**
 * Parse a template string, extracting slots ([NAME]) and variables ({{var}}).
 */
export function parseTemplate(template: string): ParsedTemplate {
  const slots: TemplateSlot[] = []
  const variables: string[] = []

  let match: RegExpExecArray | null

  const slotRe = new RegExp(SLOT_PATTERN.source, 'g')
  while ((match = slotRe.exec(template)) !== null) {
    slots.push({
      name: match[1],
      index: match.index,
      length: match[0].length,
    })
  }

  const varRe = new RegExp(VARIABLE_PATTERN.source, 'g')
  while ((match = varRe.exec(template)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1])
    }
  }

  return { raw: template, slots, variables }
}

/**
 * Resolve {{variable}} placeholders in a template using a lookup map.
 * Unresolved variables are left as-is.
 */
export function resolveVariables(template: string, vars: Record<string, string>): string {
  return template.replace(VARIABLE_PATTERN, (fullMatch, name: string) => {
    return name in vars ? vars[name] : fullMatch
  })
}

/**
 * Find the next [SLOT] at or after the given cursor position.
 * Wraps around to the beginning if no slot is found after the cursor.
 * Returns null if the text contains no slots.
 */
export function findNextSlot(text: string, cursorPosition: number): TemplateSlot | null {
  const { slots } = parseTemplate(text)
  if (slots.length === 0) return null

  // Find first slot at or after cursor
  for (const slot of slots) {
    if (slot.index >= cursorPosition) return slot
  }

  // Wrap around to the first slot
  return slots[0]
}

/**
 * Find the previous [SLOT] before the given cursor position.
 * Wraps around to the last slot if no slot is found before the cursor.
 * Returns null if the text contains no slots.
 */
export function findPreviousSlot(text: string, cursorPosition: number): TemplateSlot | null {
  const { slots } = parseTemplate(text)
  if (slots.length === 0) return null

  // Find last slot before cursor
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].index < cursorPosition) return slots[i]
  }

  // Wrap around to the last slot
  return slots[slots.length - 1]
}

/**
 * Check if a template string contains any [SLOT] placeholders.
 */
export function hasSlots(template: string): boolean {
  return SLOT_PATTERN.test(template)
}

/**
 * Check if a template string contains any {{variable}} placeholders.
 */
export function hasVariables(template: string): boolean {
  return VARIABLE_PATTERN.test(template)
}
