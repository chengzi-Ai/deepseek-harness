import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// validate.js is a classic browser script; compile it and capture the
// function it declares (it touches no globals).
const source = readFileSync(join(import.meta.dirname, '..', 'www', 'validate.js'), 'utf8')
const validateServerUrl = new Function(source + '\nreturn validateServerUrl')() as (value: string) => boolean

describe('validateServerUrl', () => {
  it('accepts http and https server URLs', () => {
    expect(validateServerUrl('http://100.64.0.1:3080')).toBe(true)
    expect(validateServerUrl('https://your-server.example')).toBe(true)
    expect(validateServerUrl('  https://padded.example/  ')).toBe(true)
  })

  it('rejects non-URL input', () => {
    expect(validateServerUrl('')).toBe(false)
    expect(validateServerUrl('localhost:3080')).toBe(false)
    expect(validateServerUrl('ftp://example')).toBe(false)
  })
})
