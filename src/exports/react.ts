// Booking UI for the host's own site. Browser-safe: no node:crypto, no secrets, and never
// imports @payloadcms/ui, so a public page does not pull in the admin bundle.
//
// Three layers. The hooks are the reusable part; the components are one possible shape
// built on them, and are meant to be replaced rather than fought.
export { BookingForm } from '../react/BookingForm.js'
export { CancelView } from '../react/CancelView.js'
export { defaultMessages, resolveMessages } from '../react/messages.js'
export type { Messages } from '../react/messages.js'
export type {
  BookingClassNames,
  BookingSuccess,
  CancelLookup,
  CancelState,
  CustomerFieldDescriptor,
  Day,
  Slot,
} from '../react/types.js'
export {
  CORE_CUSTOMER_FIELDS,
  FIELD_ERROR_INVALID_EMAIL,
  FIELD_ERROR_REQUIRED,
  useAvailability,
  useBooking,
  useBookingFlow,
  useFormToken,
} from '../react/useBookingFlow.js'
export type {
  AvailabilityMeta,
  BookingAttempt,
  BookingErrorCode,
  BookingFlow,
  BookingFlowOptions,
  BookingPayload,
} from '../react/useBookingFlow.js'
export { useCancelFlow } from '../react/useCancelFlow.js'
export type { CancelErrorCode, CancelFlow } from '../react/useCancelFlow.js'
