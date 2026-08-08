/* eslint-disable no-console */
// Verify failure injection: arm a real parse failure BEFORE upload (upload
// auto-triggers the pipeline), then confirm the orchestrator retries and the
// document recovers to READY.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const SAMPLE_MD = `# Retry Test Document

This document verifies the retry path.

## Section

Content with a formula: $x^2 + y^2 = z^2$
`;

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.click('text=Workspace');
  await page.waitForTimeout(800);

  // Go to Runtime Lab and arm the "Fail parse once" injection.
  await page.click('button:has-text("Runtime Lab")');
  await page.waitForTimeout(500);
  const failParseBtn = page.locator('button:has-text("Fail parse once")').first();
  const hasInjection = await failParseBtn.count();
  console.log('Failure injection UI available:', hasInjection > 0 ? 'YES' : 'NO');

  if (hasInjection > 0) {
    await failParseBtn.click();
    await page.waitForTimeout(300);

    // Upload — this auto-triggers the real pipeline, which fails once then retries.
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: 'retry-test.md', mimeType: 'text/markdown', buffer: Buffer.from(SAMPLE_MD, 'utf-8') });
    await page.waitForTimeout(10000);

    const body = await page.locator('body').innerText();
    // The parse task should have retried and succeeded.
    console.log('Pipeline executed:', /SUCCESS|RETRYING|FAILED/.test(body) ? 'YES' : 'NO');
    console.log('Task reached SUCCESS:', body.includes('SUCCESS') ? 'YES' : 'NO');
    console.log('Recovery/retry evidence:', body.includes('×1') || body.includes('Retries') || body.includes('retries') ? 'CHECK' : 'none');

    // Check document status recovered to READY.
    console.log('Document recovered READY:', body.includes('READY') ? 'YES' : 'NO');
  }

  console.log('PAGE ERRORS:', pageErrors.length ? pageErrors.join(' | ') : 'NONE');
  await browser.close();
}

main().catch((e) => { console.error('ERR:', e); process.exit(1); });
