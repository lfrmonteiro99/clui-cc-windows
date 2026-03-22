/** Types for the Session Fault Memory / "Never Ask Twice" feature. */

export type FactCategory = 'tooling' | 'style' | 'convention' | 'preference' | 'other'

export interface ProjectFact {
  id: string                    // UUID
  project: string               // Working directory path
  pattern: string               // What was wrong (e.g., "npm")
  correction: string            // What's right (e.g., "pnpm")
  context: string               // Full correction text from the user
  category: FactCategory
  createdAt: number
  usageCount: number            // How many times injected as preamble
  lastUsedAt: number
}
