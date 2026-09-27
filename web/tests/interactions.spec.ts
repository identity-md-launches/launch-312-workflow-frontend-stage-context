import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { parseEther } from 'viem';
import { app, ACCOUNT, CREATOR, deployment, mock, MockChain, token } from './mock';

const first = (page: Page) => page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'A tiny community library' }) });
async function connect(page: Page) { await page.getByRole('button', { name: 'Connect wallet' }).click(); await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeEnabled(); }
async function openFirst(page: Page) { const card = first(page); await card.getByText('View pledge & actions').click(); return card; }
async function settled(page: Page) { await expect(page.getByRole('status')).toContainText(/confirmed/i); await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeEnabled(); }

test('disconnected, missing wallet, empty list and read failure are recoverable', async ({ page }) => {
  const chain = await mock(page, new MockChain(), false);
  chain.campaigns = [];
  await page.goto('./');
  await expect(page.getByText('Every first pledge starts somewhere.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No browser wallet found' })).toBeVisible();
  await page.screenshot({ path: '../docs/evidence/desktop-empty.png', fullPage: true });
  chain.failRpc = true;
  await page.getByRole('button', { name: 'Refresh', exact: false }).click();
  await expect(page.getByText('Live reads unavailable.')).toBeVisible();
  chain.failRpc = false;
  await page.getByRole('button', { name: 'Refresh', exact: false }).click();
  await expect(page.getByText('Every first pledge starts somewhere.')).toBeVisible();
});

test('unknown chain adds exact supplied network and switches again', async ({ page }) => {
  const chain = await mock(page);
  chain.chain = '0x1'; chain.missingChain = true;
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeEnabled();
  expect(chain.calls.filter(c => c.method === 'wallet_switchEthereumChain')).toHaveLength(2);
  expect(chain.calls.find(c => c.method === 'wallet_addEthereumChain')?.params).toEqual([deployment.walletAddChain]);
});

test('approval is separate and exact, then pledge and partial unpledge refresh balances', async ({ page }) => {
  const chain = await mock(page);
  await page.goto('./'); await connect(page);
  const card = await openFirst(page);
  await expect(card.getByRole('button', { name: '2. Pledge KICK' })).toBeDisabled();
  await card.getByLabel('Amount in KICK').fill('25.000000000000000001');
  await card.getByRole('button', { name: '1. Approve KICK' }).click(); await settled(page);
  expect(chain.sent[0].functionName).toBe('approve');
  expect(chain.sent[0].to.toLowerCase()).toBe(token.address);
  expect((chain.sent[0].args[0] as string).toLowerCase()).toBe(app.address);
  expect(chain.sent[0].args[1]).toBe(parseEther('25.000000000000000001'));
  await expect(card.getByRole('button', { name: '2. Pledge KICK' })).toBeEnabled();
  await card.getByRole('button', { name: '2. Pledge KICK' }).click(); await settled(page);
  expect(chain.sent[1].functionName).toBe('pledge');
  await expect(page.locator('.wallet-numbers')).toContainText('2474.999999999999999999');
  await expect(card.getByRole('button', { name: '2. Pledge KICK' })).toBeDisabled();
  await card.getByLabel('Amount in KICK').fill('5');
  await card.getByRole('button', { name: 'Unpledge KICK', exact: true }).click(); await settled(page);
  expect(chain.sent[2].functionName).toBe('unpledge');
  expect(chain.pledges.get(1n)).toBe(parseEther('70.000000000000000001'));
  const locked = page.getByRole('article').filter({ hasText: 'A seed for the neighbourhood' });
  await locked.getByText('View pledge & actions').click();
  await expect(locked.getByRole('button', { name: 'Unpledge KICK', exact: true })).toBeDisabled();
  await expect(locked.getByText('Goal reached. Pledges are locked.')).toBeVisible();
  expect(chain.calls.filter(c => c.method === 'eth_call').length).toBeGreaterThan(chain.sent.length);
});

test('create validates UTF-8, precision and deadline; writes exact arguments', async ({ page }) => {
  const chain = await mock(page);
  await page.goto('./'); await connect(page);
  const create = page.getByRole('button', { name: 'Create campaign', exact: true });
  await page.getByLabel('Campaign title', { exact: true }).fill('🌱'.repeat(9));
  await create.click(); await expect(page.getByText('Use a title of 1–32 UTF-8 bytes.')).toBeVisible();
  await page.getByLabel('Campaign title', { exact: true }).fill('A new shared experiment');
  await page.getByLabel('Funding goal').fill('1.0000000000000000001');
  await create.click(); await expect(page.getByText('Enter a positive KICK amount with up to 18 decimals.')).toBeVisible();
  await page.getByLabel('Funding goal').fill('0.5'); await create.click();
  await expect(page.getByText('Set a goal of at least 1 KICK.')).toBeVisible();
  await page.getByLabel('Funding goal').fill('1000');
  await page.getByLabel('Deadline your local time').fill('2020-01-01T12:00'); await create.click();
  await expect(page.getByText('Choose a deadline between 1 hour and 90 days from the current block time.')).toBeVisible();
  const deadline = new Date((Number(chain.now) + 172800) * 1000).toISOString().slice(0, 16);
  await page.getByLabel('Deadline your local time').fill(deadline);
  await create.click(); await settled(page);
  expect(chain.sent[0].functionName).toBe('create');
  expect(chain.sent[0].args[0]).toBe(parseEther('1000'));
  expect(chain.sent[0].args[1]).toBe(BigInt(new Date(deadline).getTime() / 1000));
  await expect(page.getByRole('heading', { name: 'A new shared experiment' })).toBeVisible();
});

test('funded claim pays creator; failed refund only clears caller pledge; terminal states lock', async ({ page }) => {
  const chain = await mock(page);
  // Exact deadline: settlement is enabled, and pledge is absent.
  chain.campaigns[2].deadline = chain.now;
  chain.campaigns[3].deadline = chain.now;
  await page.goto('./'); await connect(page);
  const funded = page.getByRole('article').filter({ hasText: 'Make room for more ideas' });
  await funded.getByText('View pledge & actions').click();
  await expect(funded.getByText('The full 525 KICK goes to the creator.')).toBeVisible();
  await funded.getByRole('button', { name: 'Claim for creator' }).click(); await settled(page);
  expect(chain.sent[0].args).toEqual([3n]);
  await expect(funded.getByText('Claimed', { exact: true })).toBeVisible();
  await expect(funded.getByRole('button', { name: 'Claim for creator' })).toHaveCount(0);
  const failed = page.getByRole('article').filter({ hasText: 'The little weekend experiment' });
  await failed.getByText('View pledge & actions').click();
  await failed.getByRole('button', { name: 'Refund my pledge' }).click(); await settled(page);
  expect(chain.sent[1].args).toEqual([4n]);
  expect(chain.pledges.get(1n)).toBe(parseEther('50'));
  await expect(failed.getByRole('button', { name: 'Refund my pledge' })).toBeDisabled();
});

test('wallet rejection, simulation revert and invalid amounts never submit', async ({ page }) => {
  const chain = await mock(page);
  await page.goto('./'); chain.reject = true;
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText('Request declined in your wallet.')).toBeVisible();
  chain.reject = false; await connect(page);
  const card = await openFirst(page);
  for (const invalid of ['0', '-2', '1e3', '0.0000000000000000001', '2501']) {
    await card.getByLabel('Amount in KICK').fill(invalid);
    await card.getByRole('button', { name: '1. Approve KICK' }).click();
    await expect(card.locator('.field-error')).not.toBeEmpty();
  }
  await card.getByLabel('Amount in KICK').fill('5'); chain.reject = true;
  await card.getByRole('button', { name: '1. Approve KICK' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Request declined' })).toBeVisible();
  chain.reject = false; chain.revert = 'CampaignEnded';
  await card.getByRole('button', { name: '1. Approve KICK' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'CampaignEnded' })).toBeVisible();
  expect(chain.sent).toHaveLength(0);
});

test('account and chain events clear stale balances; disconnect disables actions', async ({ page }) => {
  const chain = await mock(page);
  await page.goto('./'); await connect(page);
  await expect(page.locator('.wallet-numbers')).toContainText('2500');
  chain.account = CREATOR;
  await page.evaluate(account => (window as unknown as { __emit: (event: string, value: unknown) => void }).__emit('accountsChanged', [account]), CREATOR);
  await expect(page.locator('.wallet-numbers')).not.toContainText('2500');
  chain.chain = '0x1';
  await page.evaluate(() => (window as unknown as { __emit: (event: string, value: unknown) => void }).__emit('chainChanged', '0x1'));
  await expect(page.getByRole('button', { name: 'Switch to Sepolia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeDisabled();
  expect(chain.sent).toHaveLength(0);
});

test('missing code, token mismatch and ABI tampering block all signing', async ({ page }) => {
  const chain = await mock(page); chain.missingCode = true;
  await page.goto('./');
  await expect(page.getByText('Deployed contract code is missing.')).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeDisabled();
  chain.missingCode = false; chain.badToken = true;
  await page.getByRole('button', { name: 'Refresh', exact: false }).click();
  await expect(page.getByText('Campaign currency does not match')).toBeVisible();
  await page.route('**/abi/LaunchToken.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.reload();
  await expect(page.getByText('LaunchToken ABI verification failed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeDisabled();
  expect(chain.sent).toHaveLength(0);
});

test('production subpath, desktop/mobile reflow, keyboard, accessibility and visual evidence', async ({ page }) => {
  await mock(page);
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => failed.push(r.url()));
  await page.goto('./'); await connect(page);
  await openFirst(page);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await writeFile('../docs/evidence/accessibility.json', JSON.stringify({ url: 'local /preview/ production export', violations: audit.violations, passes: audit.passes.map(p => p.id), incomplete: audit.incomplete.map(p => ({ id: p.id, nodes: p.nodes.length })) }, null, 2));
  expect(audit.violations).toEqual([]);
  const widths = [1440, 820, 375, 320];
  const observations = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(width); expect(size.body).toBeLessThanOrEqual(width);
    observations.push(size);
    await page.screenshot({ path: `../docs/evidence/width-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.create-panel').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(1000);
  await page.screenshot({ path: '../docs/evidence/text-200.png', fullPage: true });
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByRole('button', { name: 'Create campaign', exact: true }).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.reload();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.screenshot({ path: '../docs/evidence/keyboard-focus.png' });
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Connect wallet' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeEnabled();
  await first(page).locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(first(page).getByLabel('Amount in KICK')).toBeVisible();
  const contrast = await page.evaluate(() => {
    function luminance(color: string) { const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; }
    return ['body', '.hero-copy', '.hero-note', '.create-panel .input-hint', '.create-button', '.campaign-card h3', '.badge', '.card-meta'].map(selector => {
      const node = document.querySelector(selector)!;
      const foreground = getComputedStyle(node).color;
      let ancestor: Element | null = node;
      let background = 'rgba(0, 0, 0, 0)';
      while (ancestor && background === 'rgba(0, 0, 0, 0)') { background = getComputedStyle(ancestor).backgroundColor; ancestor = ancestor.parentElement; }
      const a = luminance(foreground), b = luminance(background);
      return { selector, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  expect(contrast.every(pair => pair.ratio >= 4.5)).toBe(true);
  await writeFile('../docs/evidence/browser-review.json', JSON.stringify({ observations, textResize200Percent: 'passed; CSS root font-size, not browser-native zoom', reducedMotion: '0s button transitions', contrast, pageErrors: errors, failedRequests: failed, fixtureWallet: ACCOUNT }, null, 2));
  expect(errors).toEqual([]); expect(failed).toEqual([]);
});
