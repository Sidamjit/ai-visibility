#!/usr/bin/env node
/**
 * Capture dashboard screenshots into docs/screenshots using a headless browser.
 *
 *   BASE_URL=http://localhost:3000 CHROME_PATH=/usr/bin/google-chrome npm run screenshots
 *
 * Requires the app to be running with the demo seed. Uses playwright-core with
 * an installed Chrome/Chromium (set CHROME_PATH), so no browser download needed.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

async function session(email) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login')),
    page.click('button[type=submit]'),
  ]);
  return { ctx, page };
}

async function shot(page, path, file, { full = true } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // let charts lay out
  await page.screenshot({ path: `${OUT}${file}`, fullPage: full });
  console.log(`saved docs/screenshots/${file}`);
}

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await shot(page, '/login', '00-login.png', { full: false });
  await ctx.close();
}
{
  const { ctx, page } = await session('exec@demo.local');
  await shot(page, '/executive', '01-executive-dashboard.png');
  await shot(page, '/report', '07-report.png', { full: false });
  // The same printable report rendered to PDF (what "Print / Save as PDF" produces).
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}sample-report.pdf`, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  console.log('saved docs/screenshots/sample-report.pdf');
  await ctx.close();
}
{
  const { ctx, page } = await session('it@demo.local');
  await shot(page, '/it', '02-ict-dashboard.png');
  await page.goto(`${BASE}/it`);
  const href = await page.locator('a[href^="/it/sites/"]').first().getAttribute('href');
  if (href) await shot(page, href, '03-ict-site-drilldown.png');
  await shot(page, '/it/remediation', '04-ict-remediation-checklist.png', { full: false });
  await shot(page, '/connectors', '08-connectors.png');
  await shot(page, '/settings/assumptions', '09-assumptions.png');
  await ctx.close();
}
{
  const { ctx, page } = await session('manager@demo.local');
  await shot(page, '/manager', '05-manager-dashboard.png');
  await shot(page, '/recommendations', '06-recommendations.png');
  await ctx.close();
}
await browser.close();
