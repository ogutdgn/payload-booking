import React from 'react'

import { BookingWizard } from './BookingWizard.js'

/**
 * A second booking page in a completely different shape, on the same hook and with no
 * plugin styling at all. Proof that the hook is not tied to the component we ship.
 */
export default function WizardPage() {
  return <BookingWizard />
}
