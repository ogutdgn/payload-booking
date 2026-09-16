import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

/**
 * The flows only a browser can prove.
 *
 * Everything else is covered by the integration suite against a real database; these cover
 * what depends on what the visitor sees and on state surviving a failed submit.
 */

const uniqueEmail = (): string => `e2e-${String(Date.now())}@example.com`

const fillDetails = async (page: Page, email: string): Promise<void> => {
  await page.getByLabel('Name *').fill('E2E Visitor')
  await page.getByLabel('Email *').fill(email)
  await page.getByLabel('Phone *').fill('(512) 555-0199')
}

test('books a slot and shows the confirmation', async ({ page }) => {
  await page.goto('/schedule')

  const slot = page.locator('.booking-slot:not([disabled])').first()

  await expect(slot).toBeVisible()

  const label = (await slot.textContent())?.trim() ?? ''

  await slot.click()
  await fillDetails(page, uniqueEmail())

  // The anti-bot trap rejects anything submitted within three seconds of the form loading.
  await page.waitForTimeout(3500)
  await page.getByRole('button', { name: 'Book this time' }).click()

  await expect(page.getByText('Your appointment is booked')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(label)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add to calendar' })).toBeVisible()
})

test('keeps what the visitor typed when the slot is taken first', async ({ page, request }) => {
  await page.goto('/schedule')

  const slot = page.locator('.booking-slot:not([disabled])').first()

  await expect(slot).toBeVisible()

  const start = await slot.evaluate((node) => {
    const buttons = Array.from(document.querySelectorAll('.booking-slot:not([disabled])'))

    return String(buttons.indexOf(node as Element))
  })

  await slot.click()
  await fillDetails(page, uniqueEmail())
  await page.getByLabel('Anything we should know? (optional)').fill('Please call ahead.')

  // Someone else books the same time while this visitor is typing.
  const tokenResponse = await request.get('/api/booking/form-token')
  const { formToken } = (await tokenResponse.json()) as { formToken: string }
  const availability = await request.get('/api/booking/availability')
  const body = (await availability.json()) as {
    days: { slots: { available: boolean; start: string }[] }[]
  }
  const taken = body.days.flatMap((day) => day.slots).filter((entry) => entry.available)[
    Number(start)
  ]

  await page.waitForTimeout(3500)
  await request.post('/api/booking/book', {
    data: {
      customer: {
        name: 'Someone Else',
        email: uniqueEmail(),
        phone: '(512) 555-0100',
      },
      formToken,
      start: taken.start,
    },
  })

  await page.getByRole('button', { name: 'Book this time' }).click()

  // The plain-English explanation, and everything they typed still there.
  await expect(page.getByText(/someone just took that time/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Name *')).toHaveValue('E2E Visitor')
  await expect(page.getByLabel('Phone *')).toHaveValue('(512) 555-0199')
  await expect(page.getByLabel('Anything we should know? (optional)')).toHaveValue(
    'Please call ahead.',
  )

  // And the slot that vanished is greyed out rather than silently still clickable.
  await expect(page.locator('.booking-slot[data-unavailable="true"]').first()).toBeVisible()
})

test('shows a plain message for a link it does not recognise', async ({ page }) => {
  await page.goto('/appointments/cancel/not-a-real-token')

  await expect(page.getByText(/do not recognise this link/i)).toBeVisible({ timeout: 15_000 })
  // Every cancel state carries the phone number, including the unusable ones.
  await expect(page.getByText(/\(512\) 555-0100/)).toBeVisible()
})
