/**
 * A customer field, described in a way a browser can render.
 *
 * Payload's own field configs carry functions (validation, access, hooks, label
 * functions), so they cannot cross into a client component. The host converts them once on
 * the server with `toCustomerFieldDescriptors` and passes these down.
 */
export type CustomerFieldDescriptor = {
  label: string
  name: string
  options?: { label: string; value: string }[]
  placeholder?: string
  required?: boolean
  type: 'checkbox' | 'email' | 'number' | 'select' | 'text' | 'textarea'
}

export type Slot = {
  available: boolean
  end: string
  label: string
  remaining: number
  start: string
}

export type Day = {
  closed: boolean
  date: string
  label: string
  slots: Slot[]
}

export type AvailabilityResponse = {
  days: Day[]
  meta: {
    labels: { hour12: boolean; locale: string }
    phone: string
    resource?: { id: number | string; slug?: string }
    timezone: string
  }
}

export type BookingSuccess = {
  end: string
  googleCalendarUrl: string
  icsContent: string
  id: number | string
  label: string
  reference: string
  start: string
}

export type CancelState = 'cancelled' | 'expired' | 'invalid' | 'past' | 'valid'

export type CancelLookup = {
  appointment?: {
    customerName: string
    localDate: string
    localTime: string
    status: string
    timezone: string
  }
  bookUrl: string
  phone: string
  state: CancelState
}

/**
 * Class names for every element the components render.
 *
 * The components ship no styling of their own beyond an optional stylesheet, so a host
 * drops in its own design system by naming the parts rather than overriding CSS.
 */
export type BookingClassNames = Partial<
  Record<
    | 'button'
    | 'day'
    | 'dayHeading'
    | 'dayList'
    | 'error'
    | 'field'
    | 'fieldError'
    | 'form'
    | 'input'
    | 'label'
    | 'notice'
    | 'root'
    | 'slot'
    | 'slotGrid'
    | 'slotSelected'
    | 'slotUnavailable'
    | 'success',
    string
  >
>

export const cx = (...values: (false | null | string | undefined)[]): string =>
  values.filter(Boolean).join(' ')
