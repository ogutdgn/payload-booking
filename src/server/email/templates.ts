import type { EmailEvent, EmailRendered, EmailViewModelFor } from '../../types.js'

/**
 * Escape for HTML interpolation.
 *
 * Every value in a view model came from a visitor typing into a public form, so the
 * default templates escape all of them. Host-supplied templates receive the plain values
 * and own their own escaping, which the option's documentation states.
 */
export const escapeHtml = (value: null | number | string | undefined): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const layout = (args: { body: string; heading: string }): string => `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px"><tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(args.heading)}</h1>
${args.body}
</td></tr></table>
</body></html>`

const paragraph = (text: string): string =>
  `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${text}</p>`

const detail = (label: string, value: string): string =>
  `<p style="margin:0 0 6px;font-size:15px;line-height:1.5"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`

const button = (href: string, label: string): string =>
  `<p style="margin:20px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#ffffff;border-radius:6px;text-decoration:none;font-size:15px">${escapeHtml(label)}</a></p>`

const when = (vm: { localDate: string; localTime: string }): string =>
  `${vm.localDate} at ${vm.localTime}`

const customerConfirmed = (vm: EmailViewModelFor<'customer.confirmed'>): EmailRendered => {
  const text = [
    `Hello ${vm.customerName},`,
    '',
    `Your appointment is confirmed for ${when(vm)} (${vm.timezone}).`,
    `Where: ${vm.location}`,
    vm.note ? `\n${vm.note}` : '',
    '',
    `Need to cancel? ${vm.cancelUrl}`,
    `Questions? Call ${vm.phone}.`,
  ]
    .filter((line) => line !== undefined)
    .join('\n')

  return {
    html: layout({
      body: [
        paragraph(`Hello ${escapeHtml(vm.customerName)},`),
        paragraph('Your appointment is confirmed.'),
        detail('When', `${when(vm)} (${vm.timezone})`),
        detail('Where', vm.location),
        vm.note ? paragraph(escapeHtml(vm.note)) : '',
        button(vm.cancelUrl, 'Cancel this appointment'),
        paragraph(`Questions? Call ${escapeHtml(vm.phone)}.`),
      ].join('\n'),
      heading: 'Your appointment is confirmed',
    }),
    subject: `Your appointment on ${vm.localDate} at ${vm.localTime}`,
    text,
  }
}

const businessBooked = (vm: EmailViewModelFor<'business.booked'>): EmailRendered => {
  const custom = Object.entries(vm.customFields)

  return {
    html: layout({
      body: [
        detail('When', `${when(vm)} (${vm.timezone})`),
        detail('Name', vm.customerName),
        detail('Phone', vm.customerPhone),
        detail('Email', vm.customerEmail),
        ...custom.map(([key, value]) => detail(key, value)),
        vm.message ? paragraph(`<strong>Message:</strong> ${escapeHtml(vm.message)}`) : '',
        vm.adminUrl ? button(vm.adminUrl, 'Open in the dashboard') : '',
      ].join('\n'),
      heading: 'New booking',
    }),
    subject: `New booking: ${vm.customerName}, ${vm.localDate} at ${vm.localTime}`,
    text: [
      'New booking.',
      '',
      `When: ${when(vm)} (${vm.timezone})`,
      `Name: ${vm.customerName}`,
      `Phone: ${vm.customerPhone}`,
      `Email: ${vm.customerEmail}`,
      ...custom.map(([key, value]) => `${key}: ${value}`),
      vm.message ? `\nMessage: ${vm.message}` : '',
      vm.adminUrl ? `\n${vm.adminUrl}` : '',
    ].join('\n'),
  }
}

const businessCancelledByCustomer = (
  vm: EmailViewModelFor<'business.cancelledByCustomer'>,
): EmailRendered => ({
  html: layout({
    body: [
      paragraph(`${escapeHtml(vm.customerName)} cancelled their appointment.`),
      detail('When it was', `${when(vm)} (${vm.timezone})`),
      paragraph('The time is available to book again.'),
    ].join('\n'),
    heading: 'Appointment cancelled',
  }),
  subject: `Cancelled: ${vm.customerName}, ${vm.localDate} at ${vm.localTime}`,
  text: [
    `${vm.customerName} cancelled their appointment.`,
    '',
    `When it was: ${when(vm)} (${vm.timezone})`,
    'The time is available to book again.',
  ].join('\n'),
})

const customerCancelledByBusiness = (
  vm: EmailViewModelFor<'customer.cancelledByBusiness'>,
): EmailRendered => ({
  html: layout({
    body: [
      paragraph(`Hello ${escapeHtml(vm.customerName)},`),
      paragraph(`We have had to cancel your appointment on ${escapeHtml(when(vm))}.`),
      vm.reason ? detail('Reason', vm.reason) : '',
      paragraph(`Please call ${escapeHtml(vm.phone)} and we will sort out a new time.`),
      button(vm.bookUrl, 'Book a new time'),
    ].join('\n'),
    heading: 'Your appointment has been cancelled',
  }),
  subject: `Cancelled: your appointment on ${vm.localDate}`,
  text: [
    `Hello ${vm.customerName},`,
    '',
    `We have had to cancel your appointment on ${when(vm)} (${vm.timezone}).`,
    vm.reason ? `Reason: ${vm.reason}` : '',
    '',
    `Please call ${vm.phone} and we will sort out a new time.`,
    `Book a new time: ${vm.bookUrl}`,
  ].join('\n'),
})

export const defaultTemplates: {
  [E in EmailEvent]: (vm: EmailViewModelFor<E>) => EmailRendered
} = {
  'business.booked': businessBooked,
  'business.cancelledByCustomer': businessCancelledByCustomer,
  'customer.cancelledByBusiness': customerCancelledByBusiness,
  'customer.confirmed': customerConfirmed,
}
