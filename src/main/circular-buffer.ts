/**
 * CircularBuffer: O(1) push/overwrite ring buffer.
 * Replaces the array.push + array.shift pattern which is O(n) for every eviction.
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[]
  private head = 0
  private _size = 0

  constructor(private capacity: number) {
    this.buffer = new Array(capacity)
  }

  push(item: T): void {
    this.buffer[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this._size < this.capacity) this._size++
  }

  toArray(): T[] {
    if (this._size < this.capacity) return this.buffer.slice(0, this._size) as T[]
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)] as T[]
  }

  get size(): number { return this._size }

  clear(): void {
    this.head = 0
    this._size = 0
    this.buffer = new Array(this.capacity)
  }
}
