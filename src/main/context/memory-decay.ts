/**
 * CTX-007: Memory decay scoring.
 *
 * Applies a time-based penalty to memory scores based on how long ago
 * the memory was last accessed. This encourages the system to surface
 * recently relevant memories over stale ones.
 *
 * Decay tiers:
 * - 0-14 days since access: no penalty (factor = 1.0)
 * - 15-30 days since access: 25% penalty (factor = 0.75)
 * - 31+ days since access: 50% penalty (factor = 0.5)
 */

/**
 * Compute the decay factor for a memory based on days since last access.
 */
export function getDecayFactor(daysSinceAccess: number): number {
  if (daysSinceAccess > 30) return 0.5
  if (daysSinceAccess > 14) return 0.75
  return 1.0
}

/**
 * Apply memory decay to a base score.
 *
 * @param baseScore - The original relevance/importance score (0-1)
 * @param daysSinceAccess - Number of days since the memory was last accessed
 * @returns The decayed score
 */
export function applyMemoryDecay(
  baseScore: number,
  daysSinceAccess: number,
): number {
  return baseScore * getDecayFactor(daysSinceAccess)
}

/**
 * Compute days since a given timestamp (in milliseconds or ISO string).
 */
export function daysSince(timestamp: number | string): number {
  const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp
  return (Date.now() - ts) / (24 * 60 * 60 * 1000)
}
