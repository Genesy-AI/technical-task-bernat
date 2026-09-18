import { describe, it, expect } from 'vitest'
import { ISO_3166_1_ALPHA_2_CODES } from './isoCountryCodes'

describe('ISO_3166_1_ALPHA_2_CODES', () => {
  it('should contain every officially assigned code exactly once', () => {
    expect(ISO_3166_1_ALPHA_2_CODES.size).toBe(249)
  })

  it('should only contain uppercase 2-letter codes', () => {
    const malformed = [...ISO_3166_1_ALPHA_2_CODES].filter((code) => !/^[A-Z]{2}$/.test(code))
    expect(malformed).toEqual([])
  })

  it('should include codes that are easy to miss', () => {
    expect(ISO_3166_1_ALPHA_2_CODES.has('GB')).toBe(true)
    expect(ISO_3166_1_ALPHA_2_CODES.has('SS')).toBe(true)
    expect(ISO_3166_1_ALPHA_2_CODES.has('BQ')).toBe(true)
    expect(ISO_3166_1_ALPHA_2_CODES.has('CW')).toBe(true)
    expect(ISO_3166_1_ALPHA_2_CODES.has('SX')).toBe(true)
  })

  it('should exclude reserved and deprecated codes', () => {
    expect(ISO_3166_1_ALPHA_2_CODES.has('UK')).toBe(false)
    expect(ISO_3166_1_ALPHA_2_CODES.has('EU')).toBe(false)
    expect(ISO_3166_1_ALPHA_2_CODES.has('AN')).toBe(false)
    expect(ISO_3166_1_ALPHA_2_CODES.has('CS')).toBe(false)
    expect(ISO_3166_1_ALPHA_2_CODES.has('XK')).toBe(false)
  })
})
