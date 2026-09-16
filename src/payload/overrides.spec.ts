import type { CollectionConfig, Field } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import {
  applyCollectionOverride,
  APPOINTMENT_INVARIANTS,
  assertInvariants,
  protectAppointments,
} from './overrides.js'

const hook = vi.fn()

const baseCollection = (): CollectionConfig =>
  ({
    slug: 'appointments',
    access: { create: () => false, read: () => true },
    admin: { defaultColumns: ['slotStart', 'title'], useAsTitle: 'title' },
    fields: [
      { name: 'title', type: 'text' },
      { name: 'slotStart', type: 'date' },
      { name: 'slotLocalDate', type: 'text' },
      { name: 'seat', type: 'number' },
      { name: 'slotLockKey', type: 'text', unique: true },
      { name: 'status', type: 'select', options: ['confirmed'], validate: () => true },
      {
        name: 'customer',
        type: 'group',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'email', type: 'email' },
        ],
      },
    ] as Field[],
    hooks: { beforeChange: [hook] },
    labels: { plural: 'Appointments', singular: 'Appointment' },
  }) as unknown as CollectionConfig

describe('applyCollectionOverride', () => {
  it('leaves the collection alone when nothing is passed', () => {
    const base = baseCollection()

    expect(applyCollectionOverride(base, undefined)).toBe(base)
  })

  it('renames a screen without touching anything else', () => {
    const merged = applyCollectionOverride(baseCollection(), {
      labels: { plural: 'Visits', singular: 'Visit' },
    })

    expect(merged.labels).toEqual({ plural: 'Visits', singular: 'Visit' })
    expect(merged.fields).toHaveLength(7)
    expect(merged.slug).toBe('appointments')
  })

  it('merges admin settings rather than replacing the whole block', () => {
    // Changing the columns must not wipe useAsTitle, or the list loses its titles.
    const merged = applyCollectionOverride(baseCollection(), {
      admin: { defaultColumns: ['title'] },
    })

    expect(merged.admin?.defaultColumns).toEqual(['title'])
    expect(merged.admin?.useAsTitle).toBe('title')
  })

  it('adds a field through the defaultFields argument', () => {
    const merged = applyCollectionOverride(baseCollection(), {
      fields: ({ defaultFields }) => [
        ...defaultFields,
        { name: 'assignedTo', type: 'text' } as Field,
      ],
    })

    expect(merged.fields).toHaveLength(8)
    expect(merged.fields.some((field) => 'name' in field && field.name === 'assignedTo')).toBe(true)
  })

  it('keeps the plugin hooks and runs the host hooks after them', () => {
    const hostHook = vi.fn()
    const merged = applyCollectionOverride(baseCollection(), {
      hooks: { afterChange: [hostHook], beforeChange: [hostHook] },
    })

    expect(merged.hooks?.beforeChange).toEqual([hook, hostHook])
    expect(merged.hooks?.afterChange).toEqual([hostHook])
  })
})

describe('assertInvariants', () => {
  it('accepts an untouched collection', () => {
    expect(() =>
      assertInvariants({ collection: baseCollection(), invariants: APPOINTMENT_INVARIANTS }),
    ).not.toThrow()
  })

  it('refuses a collection whose lock key lost its uniqueness', () => {
    // The whole double-booking guarantee rests on this one property.
    const collection = baseCollection()

    collection.fields = collection.fields.map((field) =>
      'name' in field && field.name === 'slotLockKey' ? { ...field, unique: false } : field,
    ) as Field[]

    expect(() =>
      assertInvariants({ collection, invariants: APPOINTMENT_INVARIANTS }),
    ).toThrow(/slotLockKey/)
  })

  it('explains why, and how to fix it', () => {
    const collection = baseCollection()

    collection.fields = collection.fields.filter(
      (field) => !('name' in field && field.name === 'slotLockKey'),
    )

    expect(() => assertInvariants({ collection, invariants: APPOINTMENT_INVARIANTS })).toThrow(
      /double-booking impossible/,
    )
    expect(() => assertInvariants({ collection, invariants: APPOINTMENT_INVARIANTS })).toThrow(
      /\.\.\.defaultFields/,
    )
  })

  it('refuses a status field that lost its guard', () => {
    const collection = baseCollection()

    collection.fields = collection.fields.map((field) =>
      'name' in field && field.name === 'status' ? { ...field, validate: undefined } : field,
    ) as Field[]

    expect(() => assertInvariants({ collection, invariants: APPOINTMENT_INVARIANTS })).toThrow(
      /status/,
    )
  })

  it('refuses a collection missing any derived field the logic depends on', () => {
    for (const name of ['slotStart', 'slotLocalDate', 'seat']) {
      const collection = baseCollection()

      collection.fields = collection.fields.filter(
        (field) => !('name' in field && field.name === name),
      )

      expect(() =>
        assertInvariants({ collection, invariants: APPOINTMENT_INVARIANTS }),
      ).toThrow(new RegExp(name))
    }
  })

  it('finds protected fields nested inside groups', () => {
    const collection = baseCollection()

    expect(() =>
      assertInvariants({
        collection,
        invariants: [{ check: (field) => Boolean(field), field: 'email', reason: 'test' }],
      }),
    ).not.toThrow()
  })
})

describe('protectAppointments', () => {
  it('puts back a plugin hook the host replaced', () => {
    const base = baseCollection()
    const hostHook = vi.fn()
    const merged = applyCollectionOverride(base, {
      hooks: { beforeChange: [hostHook] },
    })

    // Simulate a host who replaced rather than appended.
    merged.hooks = { beforeChange: [hostHook] }

    const result = protectAppointments({ base, merged })

    expect(result.hooks?.beforeChange).toEqual([hook, hostHook])
  })

  it('closes public creation even if an override opened it', () => {
    const base = baseCollection()
    const merged = applyCollectionOverride(base, { access: { create: () => true } })
    const result = protectAppointments({ base, merged })

    expect(result.access?.create?.({} as never)).toBe(false)
  })

  it('keeps everything an override is allowed to change', () => {
    const base = baseCollection()
    const merged = applyCollectionOverride(base, {
      admin: { defaultColumns: ['title'] },
      labels: { plural: 'Visits', singular: 'Visit' },
    })
    const result = protectAppointments({ base, merged })

    expect(result.labels).toEqual({ plural: 'Visits', singular: 'Visit' })
    expect(result.admin?.defaultColumns).toEqual(['title'])
  })
})
