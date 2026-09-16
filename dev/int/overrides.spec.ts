import type { Config } from 'payload'

import { bookingPlugin } from '@ogutdgn/payload-booking'
import { describe, expect, it } from 'vitest'

import { bookingOptions } from '../bookingOptions.js'

/**
 * Overrides applied through the real plugin, not through the merge helper alone.
 *
 * These build a config the way a host's payload.config.ts does, so they catch anything
 * that goes wrong between the option and the collection Payload finally receives.
 */
const buildWith = (overrides?: (typeof bookingOptions)['overrides']): Config => {
  const config = { collections: [], globals: [] } as unknown as Config

  return bookingPlugin({ ...bookingOptions, overrides })(config) as Config
}

const appointmentsOf = (config: Config) =>
  config.collections!.find((collection) => collection.slug === 'appointments')!

describe('admin overrides', () => {
  it('renames a screen', () => {
    const config = buildWith({
      resources: { labels: { plural: 'Rooms', singular: 'Room' } },
    })
    const resources = config.collections!.find((c) => c.slug === 'booking-resources')!

    expect(resources.labels).toEqual({ plural: 'Rooms', singular: 'Room' })
  })

  it('adds a field of the host own to appointments', () => {
    const config = buildWith({
      appointments: {
        fields: ({ defaultFields }) => [
          ...defaultFields,
          { name: 'assignedTo', type: 'text', label: 'Assigned to' },
        ],
      },
    })

    const names = appointmentsOf(config).fields.map((f) => ('name' in f ? f.name : ''))

    expect(names).toContain('assignedTo')
    // And nothing the plugin needs went missing.
    expect(names).toContain('slotLockKey')
    expect(names).toContain('status')
  })

  it('changes which columns the list shows without losing the rest of the admin config', () => {
    const config = buildWith({
      appointments: { admin: { defaultColumns: ['title', 'status'] } },
    })
    const { admin } = appointmentsOf(config)

    expect(admin?.defaultColumns).toEqual(['title', 'status'])
    expect(admin?.useAsTitle).toBe('title')
    expect(admin?.listSearchableFields).toContain('reference')
  })

  it('changes the settings global too', () => {
    const config = buildWith({ settings: { label: 'Scheduling' } })
    const settings = config.globals!.find((g) => g.slug === 'booking-settings')!

    expect(settings.label).toBe('Scheduling')
  })

  it('refuses to start when an override removes the uniqueness that prevents double-booking', () => {
    expect(() =>
      buildWith({
        appointments: {
          fields: ({ defaultFields }) =>
            defaultFields.filter((f) => !('name' in f && f.name === 'slotLockKey')),
        },
      }),
    ).toThrow(/slotLockKey/)
  })

  it('says why it refused, and how to fix it', () => {
    try {
      buildWith({
        appointments: {
          fields: ({ defaultFields }) =>
            defaultFields.filter((f) => !('name' in f && f.name === 'slotLockKey')),
        },
      })
      expect.unreachable('expected a throw')
    } catch (error) {
      const message = (error as Error).message

      expect(message).toContain('double-booking impossible')
      expect(message).toContain('...defaultFields')
    }
  })

  it('keeps public creation closed even if an override opens it', () => {
    const config = buildWith({ appointments: { access: { create: () => true } } })

    expect(appointmentsOf(config).access!.create!({} as never)).toBe(false)
  })

  it('keeps the plugin hook when a host replaces the hook list', () => {
    const hostHook = () => ({})
    const config = buildWith({ appointments: { hooks: { beforeChange: [hostHook] } } })
    const { beforeChange } = appointmentsOf(config).hooks!

    // Two: the plugin's own derive hook, then the host's.
    expect(beforeChange).toHaveLength(2)
    expect(beforeChange![1]).toBe(hostHook)
  })

  it('behaves exactly as before when no overrides are given', () => {
    const withNone = appointmentsOf(buildWith())
    const withEmpty = appointmentsOf(buildWith({}))

    expect(withNone.fields.length).toBe(withEmpty.fields.length)
    expect(withNone.labels).toEqual(withEmpty.labels)
  })
})
