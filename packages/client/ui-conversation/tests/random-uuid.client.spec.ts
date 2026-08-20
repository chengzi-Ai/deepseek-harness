import { describe, expect, it } from 'vitest'
import { randomUuid } from '../src/client/random-uuid.ts'

describe('randomUuid', () => {
  it('produces a version 4, variant 1 UUID string', () => {
    const uuid = randomUuid()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('produces distinct ids across calls', () => {
    const ids = new Set(Array.from({ length: 64 }, () => randomUuid()))
    expect(ids.size).toBe(64)
  })
})
