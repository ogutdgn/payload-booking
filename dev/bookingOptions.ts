import type { BookingPluginOptions } from '@ogutdgn/payload-booking'

/**
 * The plugin options for the test bench, in their own module so the integration specs can
 * build the same handlers the running app uses rather than a second, drifting copy.
 *
 * These are also the reference values a host would start from.
 */
export const bookingOptions: BookingPluginOptions = {
  access: {
    configure: ({ req }) => Boolean(req.user),
    manage: ({ req }) => Boolean(req.user),
  },
  defaults: {
    resource: { name: 'Showroom' },
    settings: {
      bookingWindow: { mode: 'rolling-days', rollingDays: 14 },
      cancellationCutoffMinutes: 0,
      capacityPerSlot: 1,
      location: '2112 Rutland Dr #150, Austin, TX 78758',
      minNoticeMinutes: 120,
      notificationEmails: ['info@example.com'],
      phone: '(512) 555-0100',
      slotDurationMinutes: 60,
      timezone: 'America/Chicago',
      weeklySchedule: {
        friday: {
          open: true,
          sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'],
        },
        monday: {
          open: true,
          sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'],
        },
        saturday: { open: true, sessionStarts: ['10:00', '11:00', '13:00', '14:00'] },
        sunday: { open: false, sessionStarts: [] },
        thursday: {
          open: true,
          sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'],
        },
        tuesday: {
          open: true,
          sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'],
        },
        wednesday: {
          open: true,
          sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'],
        },
      },
    },
  },
  // One optional select, so the bench exercises a custom customer field rather than
  // only the three core ones.
  customerFields: [
    {
      name: 'purpose',
      type: 'select',
      label: 'Which room?',
      options: [
        { label: 'Kitchen', value: 'kitchen' },
        { label: 'Bathroom', value: 'bathroom' },
        { label: 'Closet', value: 'closet' },
      ],
    },
  ],
  email: { from: 'Vera Dev <bookings@example.com>' },
  routes: { bookPath: '/schedule', cancelPath: '/appointments/cancel' },
  siteUrl: 'http://localhost:3000',
  tokenSecret:
    process.env.BOOKING_TOKEN_SECRET || 'dev-only-booking-secret-change-me-32-chars',
}
