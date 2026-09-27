import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const packageVersion = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/playwright/package.json'), 'utf8')).version;
if (process.platform !== 'linux') throw new Error('The Playwright adapter qualifies Linux browser execution only');
if (packageVersion !== '1.63.0') throw new Error(`Unexpected Playwright package version ${packageVersion}`);

let browser;
try {
  process.env.FACTORY_CHROMIUM_EXECUTABLE = chromium.executablePath();
  browser = await chromium.launch({ headless: true, executablePath: '/opt/factory-web/launch-chromium.sh',
    env: { ...process.env, HOME: '/tmp/browser-home', FACTORY_BROWSER_UID: '65533', FACTORY_BROWSER_GID: '65533' },
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
