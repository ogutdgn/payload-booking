'use client'

import { useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { stringify } from 'qs-esm'
import React, { useCallback, useEffect, useState } from 'react'

type Props = {
  appointmentsSlug?: string
  disabled?: boolean
}

const upcomingQuery = (now: null | string): string =>
  stringify(
    {
      sort: 'slotStart',
      where: {
        or: [
          {
            and: [
              { status: { equals: 'confirmed' } },
              ...(now ? [{ slotStart: { greater_than_equal: now } }] : []),
            ],
          },
        ],
      },
    },
    { addQueryPrefix: true },
  )

const pastQuery = (now: null | string): string =>
  stringify(
    {
      sort: '-slotStart',
      where: {
        or: [
          { and: [{ status: { not_equals: 'confirmed' } }] },
          ...(now ? [{ and: [{ slotStart: { less_than: now } }] }] : []),
        ],
      },
    },
    { addQueryPrefix: true },
  )

/**
 * Two ways into the appointments list, instead of one list mixing next week with last year.
 *
 * The filter travels in the URL, so this stays Payload's own list view with its search,
 * pagination and bulk actions intact, rather than a custom screen that would lose them.
 *
 * The filter shape matters: the filter UI renders each `and` entry from its first key, so a
 * flat two-key filter would show as a single chip and silently drop the second condition
 * the moment the owner edited it. One field per entry keeps both visible and editable.
 */
export const NavLinks: React.FC<Props> = ({
  appointmentsSlug = 'appointments',
  disabled = false,
}) => {
  const { config } = useConfig()

  // The current time cannot be part of the first render: the server and the browser would
  // each stamp their own, React would see two different hrefs for the same element, and it
  // reports that as a hydration mismatch. So the first paint filters by status alone, and
  // the time clause is added once the component is running in the browser.
  const [now, setNow] = useState<null | string>(null)

  useEffect(() => {
    setNow(new Date().toISOString())
  }, [])

  const base = formatAdminURL({
    adminRoute: config.routes.admin,
    path: `/collections/${appointmentsSlug}`,
  })

  // Recomputed on click as well, so a tab left open overnight still means "from now".
  const goTo = useCallback(
    (build: (stamp: string) => string) =>
      (event: React.MouseEvent<HTMLAnchorElement>): void => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          return
        }

        event.preventDefault()
        window.location.href = `${base}${build(new Date().toISOString())}`
      },
    [base],
  )

  if (disabled) {
    return null
  }

  return (
    <nav aria-label="Appointments" className="nav__link-group">
      <a className="nav__link" href={`${base}${upcomingQuery(now)}`} onClick={goTo(upcomingQuery)}>
        <span className="nav__link-label">Upcoming appointments</span>
      </a>
      <a className="nav__link" href={`${base}${pastQuery(now)}`} onClick={goTo(pastQuery)}>
        <span className="nav__link-label">Past appointments</span>
      </a>
    </nav>
  )
}

export default NavLinks
