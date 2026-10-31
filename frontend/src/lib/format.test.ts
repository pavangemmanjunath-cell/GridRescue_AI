import { describe, expect, it } from 'vitest'
import { fmt, flagEmoji, suitabilityClass, weatherDesc } from './format'

describe('format helpers', () => {
  it('formats coordinates with hemispheres', () => {
    expect(fmt.coord(9.0765, 7.3986)).toBe('9.08°N, 7.40°E')
    expect(fmt.coord(-33.9, -18.4)).toBe('33.90°S, 18.40°W')
  })
  it('formats money and energy', () => {
    expect(fmt.usdShort(1_474_400)).toBe('$1.47M')
    expect(fmt.usdShort(18_600)).toBe('$19k')
    expect(fmt.kwh(1780)).toBe('1.78 MWh')
    expect(fmt.kw(255)).toBe('255 kW')
    expect(fmt.hours(0.25)).toBe('15 min')
    expect(fmt.hours(72)).toBe('3.0 days')
  })
  it('maps flags, suitability and weather codes', () => {
    expect(flagEmoji('NG')).toBe('🇳🇬')
    expect(flagEmoji('XX')).toBe('🌍')
    expect(suitabilityClass('High')).toBe('gr-chip-high')
    expect(weatherDesc(0).text).toBe('Clear sky')
    expect(weatherDesc(95).text).toBe('Thunderstorm')
  })
})
