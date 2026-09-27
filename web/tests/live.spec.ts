import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('@live production export reads configured Sepolia RPCs in Chromium', async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  const localFailures: string[] = [];
  const rpcFailures: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => (request.url().startsWith('http://127.0.0.1:') ? localFailures : rpcFailures).push(request.url()));
  await page.goto('./');
  await expect(page.locator('.read-status')).toBeVisible({ timeout: 50_000 });
  const readStatus = await page.locator('.read-status').innerText();
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeDisabled();
  await page.screenshot({ path: '../docs/evidence/live-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: '../docs/evidence/live-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  await writeFile('../docs/evidence/live-browser.json', JSON.stringify({ checkedAt: new Date().toISOString(), readStatus, resources, pageErrors, localFailures, rpcFailures, signedOrBroadcast: false }, null, 2));
  expect(pageErrors).toEqual([]);
  expect(localFailures).toEqual([]);
});
