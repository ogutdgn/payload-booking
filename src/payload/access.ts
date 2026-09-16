import type { Access, FieldAccess } from 'payload'

/**
 * Collection access may return a `Where` for row-level rules; field access must return a
 * boolean. Wrapping rather than calling the host function directly matters: treating a
 * returned `Where` as truthy would grant unconditional access to a host that meant to
 * narrow it.
 */
export const toFieldAccess =
  (access: Access): FieldAccess =>
  async (args) => {
    const result = await access(args as Parameters<Access>[0])

    return result === true
  }

/** Never writable through the admin or REST. Derived and plugin-owned fields use this. */
export const never: FieldAccess = () => false

/**
 * Writable only by a plugin endpoint.
 *
 * Field access runs whenever `overrideAccess` is false, and Payload silently deletes the
 * denied key rather than erroring. The audit fields need this variant instead of `never`
 * so a staff cancel can record who cancelled and why.
 */
export const onlyPluginWrites =
  (...contextFlags: string[]): FieldAccess =>
  ({ req }) =>
    contextFlags.some((flag) => req?.context?.[flag] === true)

export const CONTEXT_STATUS_CHANGE = 'bookingStatusChange'
export const CONTEXT_EMAIL_LOG = 'bookingEmailLog'
export const CONTEXT_SEED = 'bookingSeed'
