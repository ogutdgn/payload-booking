import { toCustomerFieldDescriptors } from '@ogutdgn/payload-booking'
import { BookingForm } from '@ogutdgn/payload-booking/react'
import React from 'react'

import { bookingOptions } from '../../../bookingOptions.js'

/**
 * The booking page a host adds.
 *
 * A server component that renders a client one: the customer field descriptors are
 * computed here, where the Payload field configs are available, and passed down as plain
 * data.
 *
 * Nothing here mints the anti-bot token. The form fetches its own on load, so this page
 * can be statically rendered without every visitor sharing one token from build time.
 */
export default function SchedulePage() {
  return (
    <>
      <h1>Book a showroom visit</h1>
      <p>Pick a time that suits you and we will confirm by email.</p>
      <BookingForm
        apiUrl="/api/booking"
        fields={toCustomerFieldDescriptors(bookingOptions.customerFields)}
      />
    </>
  )
}
