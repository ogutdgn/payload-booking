import type { Field } from 'payload'

import type { CustomerFieldDescriptor } from '../react/types.js'

import { DEFAULT_API_BASE_PATH } from '../types.js'

const SUPPORTED: CustomerFieldDescriptor['type'][] = [
  'checkbox',
  'email',
  'number',
  'select',
  'text',
  'textarea',
]

/**
 * Turn the host's Payload field configs into something a browser can render.
 *
 * A Payload field can carry validation functions, access rules, hooks and label functions,
 * none of which survive the trip to a client component. The host calls this on the server
 * and passes the result down as a plain prop.
 *
 * Unsupported types throw here, at startup, rather than rendering nothing at runtime.
 */
export const toCustomerFieldDescriptors = (fields: Field[] = []): CustomerFieldDescriptor[] =>
  fields.map((field) => {
    const name = 'name' in field ? field.name : undefined

    if (!name) {
      throw new Error('[payload-booking] Every customerFields entry needs a name.')
    }

    if (!SUPPORTED.includes(field.type as CustomerFieldDescriptor['type'])) {
      throw new Error(
        `[payload-booking] customerFields "${name}" is a ${field.type} field, which the booking form cannot render. ` +
          `Use one of: ${SUPPORTED.join(', ')}.`,
      )
    }

    const label =
      'label' in field && typeof field.label === 'string' && field.label.length > 0
        ? field.label
        : name

    const options =
      field.type === 'select' && Array.isArray(field.options)
        ? field.options.map((option) =>
            typeof option === 'string'
              ? { label: option, value: option }
              : {
                  label: typeof option.label === 'string' ? option.label : option.value,
                  value: option.value,
                },
          )
        : undefined

    return {
      name,
      type: field.type as CustomerFieldDescriptor['type'],
      label,
      options,
      required: 'required' in field ? Boolean(field.required) : false,
    }
  })

/**
 * The URL prefix the exported components fetch from.
 *
 * Both halves are host-configurable, and the components cannot read Payload's config
 * because they run outside the admin, so the host computes this once and passes it down.
 */
export const getBookingApiUrl = (args?: {
  apiBasePath?: string
  routesApi?: string
}): string => `${args?.routesApi ?? '/api'}${args?.apiBasePath ?? DEFAULT_API_BASE_PATH}`
