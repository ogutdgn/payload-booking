import { describe, expect, it } from 'vitest'

import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  icsContentType,
  icsFilename,
  toIcsStamp,
} from './ics.js'

const NOW = new Date('2026-09-16T12:00:00.000Z')

const request = () =>
  buildIcs({
    attendeeEmail: 'jane@example.com',
    end: '2026-09-18T16:00:00.000Z',
    location: '2112 Rutland Dr #150, Austin, TX 78758',
    method: 'REQUEST',
    now: NOW,
    organizerEmail: 'info@example.com',
    sequence: 0,
    start: '2026-09-18T15:00:00.000Z',
    summary: 'Showroom visit',
    uid: 'appt-1',
  })

describe('escapeIcsText', () => {
  it('escapes the characters that would otherwise end a property', () => {
    expect(escapeIcsText('Smith; Jane, & Co\\Ltd')).toBe('Smith\\; Jane\\, & Co\\\\Ltd')
  })

  it('turns real newlines into the literal escape, never a raw line break', () => {
    // A customer name carrying CRLF would otherwise split the VEVENT into broken lines.
    expect(escapeIcsText('Line one\r\nLine two')).toBe('Line one\\nLine two')
    expect(escapeIcsText('a\nb\rc')).toBe('a\\nb\\nc')
  })
})

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:Showroom visit')).toBe('SUMMARY:Showroom visit')
  })

  it('folds a long line with a leading space on each continuation', () => {
    const folded = foldIcsLine(`SUMMARY:${'x'.repeat(200)}`)
    const lines = folded.split('\r\n')

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.slice(1).every((line) => line.startsWith(' '))).toBe(true)
    expect(Buffer.from(lines[0], 'utf8').length).toBeLessThanOrEqual(75)
  })

  it('never splits a multi-byte character', () => {
    const folded = foldIcsLine(`SUMMARY:${'é'.repeat(100)}`)

    // A broken split would produce replacement characters on re-decode.
    expect(folded).not.toContain('�')
  })
})

describe('toIcsStamp', () => {
  it('uses UTC basic form', () => {
    expect(toIcsStamp('2026-09-18T15:00:00.000Z')).toBe('20260918T150000Z')
  })

  it('converts an offset instant to the same UTC stamp', () => {
    expect(toIcsStamp('2026-09-18T10:00:00.000-05:00')).toBe('20260918T150000Z')
  })
})

describe('buildIcs', () => {
  it('produces a REQUEST carrying everything a cancellation will need to match', () => {
    const ics = request()

    // Without ORGANIZER, UID and SEQUENCE, a later CANCEL cannot be matched to this event,
    // and the format could not be changed without breaking everyone already booked.
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('UID:appt-1')
    expect(ics).toContain('SEQUENCE:0')
    expect(ics).toContain('ORGANIZER:mailto:info@example.com')
    expect(ics).toContain('mailto:jane@example.com')
    expect(ics).toContain('DTSTAMP:20260916T120000Z')
    expect(ics).toContain('DTSTART:20260918T150000Z')
    expect(ics).toContain('DTEND:20260918T160000Z')
    expect(ics).toContain('STATUS:CONFIRMED')
  })

  it('produces a CANCEL that matches its REQUEST', () => {
    const cancel = buildIcs({
      end: '2026-09-18T16:00:00.000Z',
      method: 'CANCEL',
      now: NOW,
      organizerEmail: 'info@example.com',
      sequence: 1,
      start: '2026-09-18T15:00:00.000Z',
      summary: 'Showroom visit',
      uid: 'appt-1',
    })

    expect(cancel).toContain('METHOD:CANCEL')
    expect(cancel).toContain('UID:appt-1')
    expect(cancel).toContain('SEQUENCE:1')
    expect(cancel).toContain('STATUS:CANCELLED')
    expect(cancel).toContain('DTSTAMP:')
  })

  it('uses CRLF line endings throughout, as the format requires', () => {
    const ics = request()

    expect(ics.split('\r\n').length).toBeGreaterThan(10)
    expect(/[^\r]\n/.test(ics)).toBe(false)
  })

  it('stays parseable when the customer name contains newlines and semicolons', () => {
    const ics = buildIcs({
      end: '2026-09-18T16:00:00.000Z',
      method: 'REQUEST',
      now: NOW,
      sequence: 0,
      start: '2026-09-18T15:00:00.000Z',
      summary: 'Visit: Smith; Jane\r\nDROP TABLE',
      uid: 'appt-1',
    })

    const body = ics.split('\r\n')
    const summary = body.find((line) => line.startsWith('SUMMARY:'))

    expect(summary).toBe('SUMMARY:Visit: Smith\\; Jane\\nDROP TABLE')
    expect(body.filter((line) => line.startsWith('BEGIN:VEVENT'))).toHaveLength(1)
    expect(body.filter((line) => line.startsWith('END:VEVENT'))).toHaveLength(1)
  })

  it('omits optional properties rather than emitting empty ones', () => {
    const ics = buildIcs({
      end: '2026-09-18T16:00:00.000Z',
      method: 'REQUEST',
      now: NOW,
      sequence: 0,
      start: '2026-09-18T15:00:00.000Z',
      summary: 'Visit',
      uid: 'appt-1',
    })

    expect(ics).not.toContain('LOCATION:')
    expect(ics).not.toContain('ORGANIZER:')
  })
})

describe('attachment metadata', () => {
  it('matches the MIME method parameter to the file, which clients key on', () => {
    // A cancellation labelled method=REQUEST reads as a fresh invitation.
    expect(icsContentType('REQUEST')).toContain('method=REQUEST')
    expect(icsContentType('CANCEL')).toContain('method=CANCEL')
  })

  it('names the two files differently so a mail client shows them apart', () => {
    expect(icsFilename('REQUEST')).toBe('appointment.ics')
    expect(icsFilename('CANCEL')).toBe('cancellation.ics')
  })
})

describe('googleCalendarUrl', () => {
  it('builds a template link with a UTC date range', () => {
    const url = new URL(
      googleCalendarUrl({
        end: '2026-09-18T16:00:00.000Z',
        location: 'Austin, TX',
        start: '2026-09-18T15:00:00.000Z',
        summary: 'Showroom visit',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20260918T150000Z/20260918T160000Z')
    expect(url.searchParams.get('text')).toBe('Showroom visit')
    expect(url.searchParams.get('location')).toBe('Austin, TX')
  })

  it('encodes values rather than letting them break the query string', () => {
    const url = new URL(
      googleCalendarUrl({
        end: '2026-09-18T16:00:00.000Z',
        start: '2026-09-18T15:00:00.000Z',
        summary: 'Visit & measure #1',
      }),
    )

    expect(url.searchParams.get('text')).toBe('Visit & measure #1')
  })
})
