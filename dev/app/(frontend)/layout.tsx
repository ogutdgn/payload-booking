import type { Metadata } from 'next'

import React from 'react'
import '@ogutdgn/payload-booking/styles.css'

export const metadata: Metadata = {
  description: 'The plugin test bench',
  title: 'Vera Dev',
}

/**
 * The public side of the test bench.
 *
 * Deliberately plain: it stands in for a real site, and anything decorative here would
 * hide how the booking components look unstyled.
 */
export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        <main style={{ margin: '0 auto', maxWidth: '44rem', padding: '2rem 1.25rem' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
