const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  LOCATIONS,
  TARGET_DATE_ENV,
  TARGET_WINDOW_ENV,
  toTime,
  todayPlus,
} = require('./helpers/config');
const { attachApiCapture } = require('./helpers/apiCapture');
const { getSoonestAppointmentForLocation } = require('./helpers/appointmentFlow');
const { ensureDirExists } = require('./helpers/fsUtils');

test('dmv appointment bot - check soonest appointments by location', async ({
  browser,
}) => {
  const results = [];

  for (const locationName of LOCATIONS) {
    // Helper to run one attempt (optionally with hard reload) and clean up its context.
    const runAttempt = async (forceReload = false) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const attemptLabel = forceReload ? 'retry' : 'first';
      const safeName = locationName.replace(/\s+/g, '_');
      const { saveCapture } = attachApiCapture(page, `${safeName}-${attemptLabel}`);
      const attemptLogs = [];
      const screenshotDir = path.join(process.cwd(), 'screenshots');
      const screenshotPath = path.join(
        screenshotDir,
        `${safeName}-${attemptLabel}-${Date.now()}.png`
      );

      // Capture console logs for debugging.
      page.on('console', (msg) => {
        attemptLogs.push(`[${msg.type()}] ${msg.text()}`);
      });

      // Ensure screenshot directory exists.
      ensureDirExists(screenshotDir);

      try {
        const res = await getSoonestAppointmentForLocation(page, locationName, {
          forceReload,
        });
        return res;
      } catch (e) {
        // Take a screenshot on failure for diagnostics.
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(
            `[${locationName}] ${attemptLabel} attempt screenshot saved: ${screenshotPath}`
          );
        } catch (sErr) {
          console.log(
            `[${locationName}] ${attemptLabel} attempt screenshot failed: ${sErr?.message || sErr}`
          );
        }
        if (attemptLogs.length) {
          console.log(
            `[${locationName}] ${attemptLabel} attempt console logs:\n${attemptLogs.join('\n')}`
          );
        }
        saveCapture();
        throw e;
      } finally {
        saveCapture();
        await context.close();
      }
    };

    let res;
    try {
      res = await runAttempt(false);
    } catch (e) {
      console.log(
        `[${locationName}] first attempt error: ${e && e.message ? e.message : e
        } — retrying with hard reload`
      );
    }

    // Retry once with hard reload if first attempt threw.
    if (!res) {
      try {
        res = await runAttempt(true);
      } catch (e2) {
        res = {
          locationName,
          ok: false,
          reason: e2 && e2.message ? e2.message : String(e2),
        };
        console.log(
          `[${locationName}] retry error: ${e2 && e2.message ? e2.message : e2}`
        );
      }
    }

    results.push(res);
    if (res && res.ok) {
      console.log(
        `[${locationName}] soonest: ${res.dataVal} (${res.dateText} ${res.timeText})`
      );
    } else {
      console.log(`[${locationName}] no result: ${res ? res.reason : 'unknown error'}`);
    }

    // Keep the page open only when running locally so you can visually inspect
    // the times. In CI we skip this pause to avoid hitting test timeouts.
    if (!process.env.CI) {
      // Give a moment to observe before moving to next location.
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`Done. Locations checked: ${results.length}, successes: ${okCount}`);

  // If a target date is provided, surface any slots within ±window days of that date.
  const resolvedTargetDate = TARGET_DATE_ENV || todayPlus(60);
  const resolvedWindowDays =
    TARGET_WINDOW_ENV === '' ? 60 : Number(TARGET_WINDOW_ENV || 0);

  let alerts = [];
  if (resolvedTargetDate) {
    const targetTime = toTime(resolvedTargetDate);
    const windowMs = Math.abs(resolvedWindowDays) * 24 * 60 * 60 * 1000;
    alerts = results.filter(
      (r) => {
        if (!r.ok || !r.dataVal) return false;
        const slotDate = r.dataVal.split(' ')[0];
        const slotTime = toTime(slotDate);
        if (Number.isNaN(slotTime) || Number.isNaN(targetTime)) return false;
        return slotTime >= targetTime - windowMs && slotTime <= targetTime + windowMs;
      }
    );
    if (alerts.length) {
      console.log(
        `NOTIFY: slots within ±${resolvedWindowDays}d of ${resolvedTargetDate} -> ${JSON.stringify(
          alerts
        )}`
      );
    } else {
      console.log(
        `NOTIFY: none within ±${resolvedWindowDays}d of ${resolvedTargetDate}`
      );
    }
  }

  // Persist results for CI/notification steps.
  const outPath = path.join(process.cwd(), 'dmv-results.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    targetDate: resolvedTargetDate,
    targetWindowDays: resolvedWindowDays,
    results,
    alerts,
  };
  try {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote results to ${outPath}`);
  } catch (e) {
    console.log(`Failed to write ${outPath}: ${e && e.message ? e.message : e}`);
  }
});