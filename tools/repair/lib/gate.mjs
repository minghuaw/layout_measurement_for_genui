import { chromium } from 'playwright';
import { VIEWPORT } from '../../../src/collect.mjs';

/* gate.mjs — innerText content A/B check.
 * gate({ baseUrl, url })         — compare two live previews
 * gate({ baseline, url })        — compare a saved baseline file vs live preview
 * Returns { pass, a, b }. */

async function innerText(url) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      if (e.name !== 'TimeoutError') throw e;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    }
    await page.waitForTimeout(800);
    return await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
  } finally {
    await browser.close();
  }
}

export async function gate({ baseUrl, url, baseline }) {
  let a;
  if (baseline) {
    const { readFileSync } = await import('node:fs');
    a = readFileSync(baseline, 'utf8').trim();
  } else if (baseUrl) {
    a = await innerText(baseUrl);
  } else {
    throw new Error('gate needs --base-url or --baseline');
  }
  const b = await innerText(url);
  return { pass: a === b, a, b };
}