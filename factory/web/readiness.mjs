import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const packageVersion = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/playwright/package.json'), 'utf8')).version;
if (process.platform !== 'linux') throw new Error('The Playwright adapter qualifies Linux browser execution only');
if (packageVersion !== '1.63.0') throw new Error(`Unexpected Playwright package version ${packageVersion}`);

let browser;
try {
  mkdirSync('/tmp/browser-home', { recursive: true, mode: 0o700 });
  mkdirSync('/tmp/browser-home/cache', { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(),
    env: { ...process.env, HOME: '/tmp/browser-home', XDG_CACHE_HOME: '/tmp/browser-home/cache' },
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<button type="button">Run probe</button><output></output>');
  await page.getByRole('button', { name: 'Run probe', exact: true }).click();
  await page.locator('output').evaluate((output) => { output.textContent = 'browser-ready'; });
  if (await page.locator('output').textContent() !== 'browser-ready') throw new Error('Chromium interaction probe did not return its result');
  process.stdout.write(`${JSON.stringify({ adapter: 'playwright', version: packageVersion, browser: 'chromium', browserVersion: browser.version(), platform: 'linux-container', interaction: 'passed' })}\n`);
} finally {
  await browser?.close();
}
