/**
 * Content-type detection for streaming status badges.
 * Pure function — analyzes accumulated text to determine what Claude is writing.
 */

/** How many trailing characters to analyze (keeps detection O(1)). */
const WINDOW = 500

/**
 * Analyzes the accumulated text content and returns a contextual activity label.
 * Detection rules are applied in priority order; the first match wins.
 */
export function detectContentType(text: string): string {
  // Only look at the tail for performance
  const window = text.length > WINDOW ? text.slice(-WINDOW) : text
  // Also need full text for some patterns (code fence counting)
  const fullForFences = text.length > 4000 ? text.slice(-4000) : text

  // 1. Open code fence: ``` with no matching close
  const fenceOpens = (fullForFences.match(/^```/gm) || []).length
  if (fenceOpens > 0 && fenceOpens % 2 !== 0) {
    return 'Writing code...'
  }

  // 2. Numbered list with 2+ items → "Listing steps (N)..."
  const numberedItems = fullForFences.match(/^\d+\.\s/gm)
  if (numberedItems && numberedItems.length >= 2) {
    return `Listing steps (${numberedItems.length})...`
  }

  // 3. Table separator |---|
  if (/\|[-:]+\|/.test(window)) {
    return 'Generating table...'
  }

  // 4. Recent heading (## or ###)
  if (/^#{2,3}\s/m.test(window)) {
    return 'Structuring response...'
  }

  // 5. Default
  return 'Writing...'
}
