import type { Access, Field, PayloadRequest } from 'payload'

/** Package name, used to build every admin component path string (spec §4.1). */
export const PACKAGE_NAME = '@ogutdgn/payload-booking'

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

/** Stored / resolved schedule shape. The seed input uses `string[]` and is mapped to rows. */
export type WeeklySchedule = Record<Weekday, { open: boolean; sessionStarts: { time: string }[] }>

export type BookingWindow =
  | { mode: 'rolling-days'; rollingDays: number }
  | { mode: 'calendar-weeks'; calendarWeeks: number }

export type EmailEvent =
  | 'customer.confirmed'
  | 'business.booked'
  | 'business.cancelledByCustomer'
  | 'customer.cancelledByBusiness'

export type EmailViewModelBase = {
  bookUrl: string
  customerName: string
  localDate: string
  localTime: string
  location: string
  phone: string
  timezone: string
}

export type EmailViewModels = {
  'business.booked': EmailViewModelBase & {
    adminUrl?: string
    customerEmail: string
    customerPhone: string
    customFields: Record<string, string>
    message?: string
  }
  'business.cancelledByCustomer': EmailViewModelBase
  'customer.cancelledByBusiness': EmailViewModelBase & { reason?: string }
  'customer.confirmed': EmailViewModelBase & {
    cancelUrl: string
    icsContent: string
    note?: string
  }
}

export type EmailViewModelFor<E extends EmailEvent> = EmailViewModels[E]

export type EmailRendered = { html: string; subject: string; text: string }

export type EmailTemplate<E extends EmailEvent = EmailEvent> = (
  vm: EmailViewModelFor<E>,
) => EmailRendered | Promise<EmailRendered>

/** Seed values written once when the settings global is empty (spec §5, §6.1). */
export type BookingSettingsSeed = {
  bookingWindow: BookingWindow
  cancellationCutoffMinutes: number
  capacityPerSlot: number
  confirmationNote?: string
  location: string
  minNoticeMinutes: number
  notificationEmails: string[]
  phone: string
  slotDurationMinutes: number
  timezone: string
  weeklySchedule: Record<Weekday, { open: boolean; sessionStarts: string[] }>
}

export type BookingSlugs = {
  appointments?: string
  blackoutDates?: string
  resources?: string
  settings?: string
}

export type BookingCaps = {
  /** Rows created per ipHash in the window, any status. Default 5. */
  maxPerIpInWindow?: number
  /** Rows created per email in the window, any status. Default 3. */
  maxPerEmailInWindow?: number
  /** Upcoming rows per email: status confirmed AND slotStart >= now. Default 3. */
  maxActivePerEmail?: number
  /** Default 60. */
  windowMinutes?: number
}

export type BookingLabelOptions = {
  /** Default true. */
  hour12?: boolean
  /** Default 'en-US'. */
  locale?: string
}

export type AppointmentChangeEvent = 'booked' | 'cancelled' | 'completed' | 'no-show'

export type BookingPluginOptions = {
  /** Access control is supplied by the host; the plugin does not invent roles. */
  access: {
    /** Settings, locations, closed dates, delete (owner). */
    configure: Access
    /** Read appointments and run the status actions (staff). */
    manage: Access
  }

  /**
   * Where the plugin mounts its endpoints under Payload's API route. Default '/booking'.
   * Init throws if its first segment collides with a collection slug.
   */
  apiBasePath?: string

  /** Booking caps for the public book endpoint (spec §12). Not a request rate limit. */
  bookingCaps?: BookingCaps

  /** Timeout for `verifyChallenge`. Default 5000. */
  challengeTimeoutMs?: number

  /** Extra customer fields, appended to the customer group, never replacing. */
  customerFields?: Field[]

  /** Seed values used once when the settings global is empty. */
  defaults: {
    resource: { name: string; slug?: string }
    settings: BookingSettingsSeed
  }

  /** Disable endpoints, hook side effects, emails and seeding without removing collections. */
  disabled?: boolean

  /** Email. Sent through the host's Payload email adapter. */
  email: {
    from: string
    replyTo?: string
    templates?: { [E in EmailEvent]?: EmailTemplate<E> }
  }

  /** Resolve the client IP yourself (spec §9). */
  getClientIp?: (req: PayloadRequest) => string | undefined

  /** Name of the honeypot field the form renders and the endpoint reads. Default 'website'. */
  honeypotField?: string

  /** Label formatting for every rendered time and date. Default { locale: 'en-US', hour12: true }. */
  labels?: BookingLabelOptions

  /** Called after a booking or status change is committed. Never for emailLog writes. */
  onAppointmentChange?: (args: {
    doc: Record<string, unknown>
    event: AppointmentChangeEvent
    req: PayloadRequest
  }) => Promise<void> | void

  /** Host-owned routes the plugin links to. The plugin cannot own Next routes. */
  routes: {
    /** e.g. '/appointments/cancel' -> '/appointments/cancel/[token]' */
    cancelPath: string
    /** e.g. '/schedule' */
    bookPath: string
  }

  /** Public origin of the front-end site. Falls back to payload.config.serverURL. */
  siteUrl?: string

  /** Collection and global slugs, all overridable. */
  slugs?: BookingSlugs

  /** Timezone list for settings and slotStart. Defaults to Payload's own list. */
  supportedTimezones?: (args: {
    defaultTimezones: { label: string; value: string }[]
  }) => { label: string; value: string }[]

  /** Secret for HMACs. >= 32 chars. Never reuse PAYLOAD_SECRET. Validated at first use. */
  tokenSecret: string

  /**
   * Trust X-Forwarded-For. Set true ONLY behind a proxy that overwrites it (Vercel,
   * Cloudflare, most managed hosts). On bare Node/Docker the header is client-supplied.
   */
  trustProxy?: boolean

  /** Optional anti-abuse challenge (e.g. Cloudflare Turnstile). See spec §12. */
  verifyChallenge?: (token: string | undefined, ip: string | undefined) => Promise<boolean>
}

/** Resolved slugs with defaults applied. */
export type ResolvedSlugs = Required<BookingSlugs>

export const DEFAULT_SLUGS: ResolvedSlugs = {
  appointments: 'appointments',
  blackoutDates: 'booking-blackout-dates',
  resources: 'booking-resources',
  settings: 'booking-settings',
}

export const DEFAULT_API_BASE_PATH = '/booking'

/**
 * Statuses that hold a slot. One exported constant, used by the lock key, availability,
 * the same-person guard and the blackout guard (spec §6.4). Only `cancelled` releases.
 */
export const SLOT_HOLDING_STATUSES = ['confirmed', 'completed', 'no-show'] as const

export type AppointmentStatus = (typeof SLOT_HOLDING_STATUSES)[number] | 'cancelled'
