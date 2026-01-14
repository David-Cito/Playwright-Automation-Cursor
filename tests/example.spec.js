const { test } = require('@playwright/test');

const START_URL =
  'https://alohaq.honolulu.gov/';

// Buttons shown on the "Select location to schedule ticket at" page.
const LOCATIONS = [
  'Downtown Satellite City Hall',
  'Hawaii Kai Satellite City Hall',
  'Pearlridge Satellite City Hall',
  'Windward City Satellite City Hall',
];

// Optional threshold date (YYYY-MM-DD) to decide if a slot is "interesting".
// You can change it here or set env DMV_TARGET_DATE at runtime.
const TARGET_DATE = process.env.DMV_TARGET_DATE || '';

async function getSoonestAppointmentForLocation(page, locationName) {
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  await page.getByText('Driver Licensing and').click();
  await page.getByText('Make Appointment').click();

  // Wait for transition to the locations page. The spinner may appear briefly.
  const spinner = page.locator('.loading > .fa').first();
  try {
    await spinner.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    // Spinner didn't appear - that's OK.
  }
  await spinner.waitFor({ state: 'hidden', timeout: 60_000 });
  await page
    .getByText('Select location to schedule ticket at')
    .waitFor({ timeout: 90_000 });

  // Location pick
  const locationTile = page
    .locator('.location.button-look.next')
    .filter({ hasText: locationName })
    .first();
  await locationTile.waitFor({ state: 'visible', timeout: 30_000 });
  try {
    // Avoid scrolling too early; try clicking as-is first.
    await locationTile.click({ timeout: 10_000 });
  } catch {
    // If it isn't clickable yet (overlay/position), scroll right before retrying.
    await locationTile.scrollIntoViewIfNeeded();
    await locationTile.click({ timeout: 30_000, force: true });
  }

  // Service pick (adjust if you want a different service)
  // Wait for the next step UI rather than relying on networkidle (site keeps connections open).
  await page
    .getByText('DRIVER LICENSE & STATE ID Renewals')
    .waitFor({ timeout: 30_000 });
  await page
    .getByText('DRIVER LICENSE & STATE ID Renewals')
    .click();
  await page.waitForLoadState('networkidle');

  // "I have ALL the Required ..." acknowledgement (text varies slightly, so keep it partial)
  const requiredAck = page.getByText('I have ALL the Required');
  await requiredAck.waitFor({ timeout: 30_000 });
  await requiredAck.click();
  await page.waitForLoadState('networkidle');

  // Calendar: pick the first available *selectable* day in the jQuery UI datepicker.
  // We explicitly target the datepicker table cells that have `data-handler="selectDay"`
  // (disabled days use spans and lack this attribute).
  const datepicker = page.locator('#datepicker');
  await datepicker.waitFor({ state: 'visible', timeout: 60_000 });

  const dayLink = datepicker
    .locator('td[data-handler="selectDay"] a.ui-state-default')
    .first();
  if (!(await dayLink.count())) {
    return { locationName, ok: false, reason: 'No available day links found' };
  }
  await dayLink.click();

  // After choosing a day, the page may show the loading spinner again while it
  // fetches available times. Use a DOM-based readiness check to be robust:
  // wait until at least one `.time` element with `data-val` exists.
  await page.waitForFunction(
    () => {
      const wrap = document.querySelector('.time_wrap');
      if (!wrap) return false;
      const slots = wrap.querySelectorAll('.time[data-val]');
      return slots.length > 0;
    },
    { timeout: 60_000 }
  );

  // Now safely read all available slots from `.time_wrap .time[data-val]`.
  const slots = await page.$$eval('.time_wrap .time[data-val]', (els) =>
    els.map((el) => ({
      dataVal: el.getAttribute('data-val') || '',
      text: (el.textContent || '').trim(),
    }))
  );

  if (!slots.length) {
    return {
      locationName,
      ok: false,
      reason: 'No .time[data-val] slots found after wait',
    };
  }

  // Sort by the machine-readable timestamp; format is "YYYY-MM-DD HH:mm:ss"
  // so simple string comparison works.
  slots.sort((a, b) => a.dataVal.localeCompare(b.dataVal));
  const earliest = slots[0];

  const dateHeader =
    (await page.locator('#time_wrap_date').textContent())?.trim() || '';
  const dateFromDataVal = earliest.dataVal.split(' ')[0] || '';

  return {
    locationName,
    ok: true,
    dateText: dateHeader || dateFromDataVal,
    timeText: earliest.text || earliest.dataVal,
    dataVal: earliest.dataVal,
  };
}

test('dmv appointment bot - check soonest appointments by location', async ({
  browser,
}) => {
  const results = [];

  for (const locationName of LOCATIONS) {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const res = await getSoonestAppointmentForLocation(page, locationName);
      results.push(res);
      if (res.ok) {
        console.log(
          `[${locationName}] soonest: ${res.dataVal} (${res.dateText} ${res.timeText})`
        );
      } else {
        console.log(`[${locationName}] no result: ${res.reason}`);
      }

      // Keep the page open only when running locally so you can visually inspect
      // the times. In CI we skip this pause to avoid hitting test timeouts.
      if (!process.env.CI) {
        await page.waitForTimeout(5000);
      }
    } catch (e) {
      results.push({
        locationName,
        ok: false,
        reason: e && e.message ? e.message : String(e),
      });
      console.log(`[${locationName}] error: ${e && e.message ? e.message : e}`);
    } finally {
      await context.close();
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`Done. Locations checked: ${results.length}, successes: ${okCount}`);

  // If a target date is provided, surface any slots on/before that date.
  if (TARGET_DATE) {
    const matches = results.filter(
      (r) => r.ok && r.dataVal && r.dataVal.split(' ')[0] <= TARGET_DATE
    );
    if (matches.length) {
      console.log(
        `NOTIFY: slots on or before ${TARGET_DATE} -> ${JSON.stringify(matches)}`
      );
    } else {
      console.log(`NOTIFY: none on or before ${TARGET_DATE}`);
    }
  }
});