import { chromium } from 'playwright';
import { collectPage, VIEWPORT } from '../../../src/collect.mjs';
import { loadConfig as loadAnalyzerConfig } from '../../../src/config.mjs';
import { reportPath } from './artifacts.mjs';

/* analyze.mjs — measure a page URL with the analyzer and produce a report.
 * Runs in-process: imports collectPage directly (no subprocess). */
export async function analyze({ url, name, outDir }) {
  const { cfg } = loadAnalyzerConfig();
  const browser = await chromium.launch();
  try {
    const r = await collectPage(browser, { url, name, outDir, cfg, echo: false });
    return { issues: r.issues, report: reportPath(outDir, name), viewport: { ...VIEWPORT } };
  } finally {
    await browser.close();
  }
}