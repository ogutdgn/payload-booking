import { CancelView } from '@ogutdgn/payload-booking/react'
import React from 'react'

/**
 * The cancellation page a host adds.
 *
 * The token comes from the URL and is handed straight to the component, which reads the
 * appointment with a GET and only cancels on a POST.
 */
export default async function CancelPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return <CancelView apiUrl="/api/booking" token={token} />
}
