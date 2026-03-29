/**
 * ENRICH-009: Companion Narrator
 *
 * Generates contextual commentary during idle gaps in tool execution.
 * Buffers recent tool calls and triggers commentary when the session
 * goes idle for a configurable duration.
 */

export interface NarratorEvent {
  type: string
  toolName?: string
  timestamp: number
}

export interface NarratorConfig {
  bufferSize: number
  idleGapMs: number
  minIntervalMs: number
}

const DEFAULT_CONFIG: NarratorConfig = {
  bufferSize: 10,
  idleGapMs: 3000,
  minIntervalMs: 8000,
}

export class CompanionNarrator {
  private buffer: NarratorEvent[] = []
  private lastCommentaryAt = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private config: NarratorConfig

  constructor(
    private onIdleGap: (context: NarratorEvent[]) => void,
    config?: Partial<NarratorConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Feed a normalized event into the narrator.
   */
  pushEvent(event: NarratorEvent): void {
    if (this.stopped) return

    // Stop on task_complete
    if (event.type === 'task_complete') {
      this.stop()
      return
    }

    // Buffer the event
    this.buffer.push(event)
    if (this.buffer.length > this.config.bufferSize) {
      this.buffer = this.buffer.slice(-this.config.bufferSize)
    }

    // Reset idle timer on any activity
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    // Start idle gap detection after tool_call_complete
    if (event.type === 'tool_call_complete') {
      this.idleTimer = setTimeout(() => {
        this.triggerIdleGap()
      }, this.config.idleGapMs)
    }
  }

  private triggerIdleGap(): void {
    if (this.stopped) return

    const now = Date.now()
    if (now - this.lastCommentaryAt < this.config.minIntervalMs) {
      return
    }

    this.lastCommentaryAt = now
    this.onIdleGap([...this.buffer])
  }

  /**
   * Stop the narrator. No more commentary will be generated.
   */
  stop(): void {
    this.stopped = true
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /**
   * Check if the narrator has been stopped.
   */
  isStopped(): boolean {
    return this.stopped
  }

  /**
   * Get the current buffer contents (for prompt construction).
   */
  getBuffer(): NarratorEvent[] {
    return [...this.buffer]
  }

  /**
   * Build a prompt string from the current context buffer.
   */
  static buildPrompt(context: NarratorEvent[]): string {
    if (context.length === 0) return ''

    const toolCalls = context
      .filter((e) => e.toolName)
      .map((e) => e.toolName!)

    const uniqueTools = [...new Set(toolCalls)]

    return [
      'Recent tool activity:',
      ...uniqueTools.map((t) => `- Used ${t}`),
      '',
      'Provide a brief, helpful commentary about what is happening.',
    ].join('\n')
  }
}
