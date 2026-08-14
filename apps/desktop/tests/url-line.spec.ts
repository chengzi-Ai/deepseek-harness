import { describe, expect, it } from 'vitest'
import { parseWebUrlLine } from '../src/url-line.ts'

describe('parseWebUrlLine', () => {
  it('parses the plain readiness line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:45123')).toBe('http://127.0.0.1:45123')
  })

  it('keeps only the loopback URL when a LAN suffix follows', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.5:3080)'))
      .toBe('http://127.0.0.1:3080')
  })

  it('rejects lines that are not the readiness line', () => {
    expect(parseWebUrlLine('dsh web: not a url')).toBeUndefined()
    expect(parseWebUrlLine('some other output')).toBeUndefined()
    expect(parseWebUrlLine('')).toBeUndefined()
  })
})
