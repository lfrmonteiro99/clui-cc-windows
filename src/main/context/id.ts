import { randomBytes } from 'crypto'

export function generateId(): string {
  const now = Date.now()
  const buf = Buffer.alloc(16)

  // Timestamp (48 bits, big-endian) in first 6 bytes
  buf[0] = (now / 2 ** 40) & 0xff
  buf[1] = (now / 2 ** 32) & 0xff
  buf[2] = (now / 2 ** 24) & 0xff
  buf[3] = (now / 2 ** 16) & 0xff
  buf[4] = (now / 2 ** 8) & 0xff
  buf[5] = now & 0xff

  // Random bytes for the rest
  const rand = randomBytes(10)
  rand.copy(buf, 6)

  // Set version 7 (0111) in byte 6 high nibble
  buf[6] = (buf[6] & 0x0f) | 0x70

  // Set variant 10xx in byte 8 high bits
  buf[8] = (buf[8] & 0x3f) | 0x80

  // Format as UUID string
  const hex = buf.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
