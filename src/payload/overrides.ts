import type { CollectionConfig, Field, GlobalConfig } from 'payload'

/**
 * Host-supplied adjustments, merged into what the plugin built.
 *
 * `fields` is a function rather than an array so you can add to what is there instead of
 * replacing it, which is what you want almost every time.
 */
export type CollectionOverride = {
  fields?: (args: { defaultFields: Field[] }) => Field[]
} & Omit<Partial<CollectionConfig>, 'fields' | 'slug'>

export type GlobalOverride = {
  fields?: (args: { defaultFields: Field[] }) => Field[]
} & Omit<Partial<GlobalConfig>, 'fields' | 'slug'>

export type BookingOverrides = {
  appointments?: CollectionOverride
  blackoutDates?: CollectionOverride
  resources?: CollectionOverride
  settings?: GlobalOverride
}

/**
 * Hooks are merged rather than replaced.
 *
 * The plugin's own hooks are what derive the lock key and guard the status, so a host
 * adding an `afterChange` must not silently drop them. Theirs run after ours.
 */
const mergeHooks = <T extends Record<string, unknown[]>>(
  base: T | undefined,
  extra: Partial<T> | undefined,
): T => {
  if (!extra) {
    return (base ?? {}) as T
  }

  const merged: Record<string, unknown[]> = { ...(base ?? {}) }

  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      merged[key] = [...(merged[key] ?? []), ...value]
    }
  }

  return merged as T
}

const applyOverride = <T extends { fields: Field[] }>(base: T, override?: unknown): T => {
  if (!override) {
    return base
  }

  const { admin, fields, hooks, ...rest } = override as {
    admin?: Record<string, unknown>
    fields?: (args: { defaultFields: Field[] }) => Field[]
    hooks?: Record<string, unknown[]>
  } & Record<string, unknown>

  return {
    ...base,
    ...rest,
    admin: { ...(base as { admin?: Record<string, unknown> }).admin, ...admin },
    fields: typeof fields === 'function' ? fields({ defaultFields: base.fields }) : base.fields,
    hooks: mergeHooks(
      (base as { hooks?: Record<string, unknown[]> }).hooks,
      hooks,
    ),
  } as T
}

export const applyCollectionOverride = (
  base: CollectionConfig,
  override?: CollectionOverride,
): CollectionConfig => applyOverride(base, override)

export const applyGlobalOverride = (
  base: GlobalConfig,
  override?: GlobalOverride,
): GlobalConfig => applyOverride(base, override)

/** A field by name, looked up through groups so `customer.email` can be found. */
const findField = (fields: Field[], name: string): Field | undefined => {
  for (const field of fields) {
    if ('name' in field && field.name === name) {
      return field
    }

    if ('fields' in field && Array.isArray(field.fields)) {
      const nested = findField(field.fields, name)

      if (nested) {
        return nested
      }
    }
  }

  return undefined
}

export type Invariant = {
  check: (field: Field | undefined) => boolean
  field: string
  reason: string
}

/**
 * What an override may not change.
 *
 * Every entry here is load-bearing for a guarantee the plugin makes. If a host could
 * remove the unique lock key, "never double-booked" would be a suggestion; if they could
 * drop the status guard, a cancellation could skip the customer's email. So these are
 * checked after the merge and a violation throws at startup, naming the field and why.
 *
 * Everything else is fair game: labels, descriptions, extra fields, column order, admin
 * components, and hooks of the host's own.
 */
export const APPOINTMENT_INVARIANTS: Invariant[] = [
  {
    check: (field) => Boolean(field && 'unique' in field && field.unique === true),
    field: 'slotLockKey',
    reason:
      'it is the unique constraint that makes double-booking impossible. Without it two visitors can take the same slot.',
  },
  {
    check: (field) => Boolean(field && 'validate' in field && typeof field.validate === 'function'),
    field: 'status',
    reason:
      'its validate guard is what stops a status being changed outside the plugin endpoints, which would skip the emails and the audit trail.',
  },
  {
    check: (field) => Boolean(field),
    field: 'slotStart',
    reason: 'every slot calculation and the lock key are derived from it.',
  },
  {
    check: (field) => Boolean(field),
    field: 'slotLocalDate',
    reason: 'the closed-dates guard compares against it.',
  },
  {
    check: (field) => Boolean(field),
    field: 'seat',
    reason: 'the lock key includes it, so capacity above one depends on it.',
  },
]

export const assertInvariants = (args: {
  collection: CollectionConfig
  invariants: Invariant[]
}): void => {
  for (const invariant of args.invariants) {
    if (!invariant.check(findField(args.collection.fields, invariant.field))) {
      throw new Error(
        `[payload-booking] The "${invariant.field}" field on "${args.collection.slug}" was removed or altered by an override, but ` +
          `${invariant.reason}\n` +
          `Add to the fields rather than replacing them: fields: ({ defaultFields }) => [...defaultFields, yourField].`,
      )
    }
  }
}

/**
 * Reapply the rules an override must not weaken, after the merge.
 *
 * Checked first so a host who removed a protected field gets a readable error, then the
 * plugin's own hooks and the closed public-write rule are put back. Both are cheap and
 * both are the difference between a guarantee and a hope.
 */
export const protectAppointments = (args: {
  base: CollectionConfig
  merged: CollectionConfig
}): CollectionConfig => {
  const { base, merged } = args

  assertInvariants({ collection: merged, invariants: APPOINTMENT_INVARIANTS })

  const baseBeforeChange = base.hooks?.beforeChange ?? []
  const mergedBeforeChange = merged.hooks?.beforeChange ?? []
  const missing = baseBeforeChange.filter((hook) => !mergedBeforeChange.includes(hook))

  return {
    ...merged,
    access: {
      ...merged.access,
      // Public writes go through the booking endpoint, which runs the availability,
      // notice, closed-date and seat checks. Payload's generic create runs none of them.
      create: () => false,
    },
    hooks: {
      ...merged.hooks,
      beforeChange: [...missing, ...mergedBeforeChange],
    },
  }
}
