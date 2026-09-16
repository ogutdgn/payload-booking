/**
 * Every sentence a visitor can see.
 *
 * Kept in one object so a host can replace any of them without forking a component, and so
 * the tone stays consistent. No i18n framework: a host that needs one passes translated
 * strings in.
 *
 * `{phone}` and `{days}` are replaced at render time.
 */
export type Messages = {
  alreadyBooked: string
  bookAnother: string
  busy: string
  cancelConfirm: string
  cancelHeading: string
  cancelledAlready: string
  cancelledNow: string
  chooseTime: string
  emptyWindow: string
  expiredLink: string
  fieldRequired: string
  fullSlot: string
  genericError: string
  invalidEmail: string
  invalidLink: string
  keepDetails: string
  loading: string
  pastAppointment: string
  slotTaken: string
  submit: string
  successBody: string
  successHeading: string
  tooManyBookings: string
  yourDetails: string
}

export const defaultMessages: Messages = {
  alreadyBooked: 'You already have this time booked. Check your email for the confirmation.',
  bookAnother: 'Book a new time',
  busy: 'One moment…',
  cancelConfirm: 'Yes, cancel it',
  cancelHeading: 'Cancel your appointment',
  cancelledAlready: 'This appointment was already cancelled.',
  cancelledNow: 'Your appointment is cancelled. Thank you for letting us know.',
  chooseTime: 'Choose a time',
  emptyWindow: 'No times are available at the moment. Please call {phone}.',
  expiredLink: 'This link has expired. Please call {phone} if you still need to cancel.',
  fieldRequired: 'Please fill this in.',
  fullSlot: 'Fully booked',
  genericError: 'Something went wrong. Please try again, or call {phone}.',
  invalidEmail: 'Please enter a valid email address.',
  invalidLink: 'We do not recognise this link. Please call {phone}.',
  keepDetails: 'Your details are still here, so you only need to pick another time.',
  loading: 'Loading available times…',
  pastAppointment: 'This appointment has already passed.',
  slotTaken: 'Sorry, someone just took that time. Please choose another one.',
  submit: 'Book this time',
  successBody:
    'We have emailed you the details, including a link to cancel if your plans change.',
  successHeading: 'Your appointment is booked',
  tooManyBookings:
    'You already have several appointments booked. Please call {phone} if you need another.',
  yourDetails: 'Your details',
}

export const resolveMessages = (overrides?: Partial<Messages>): Messages => ({
  ...defaultMessages,
  ...overrides,
})

export const fill = (
  message: string,
  values: Record<string, number | string | undefined>,
): string =>
  message.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]

    return value === undefined || value === '' ? match : String(value)
  })
