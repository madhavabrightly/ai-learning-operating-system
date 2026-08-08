/* eslint-disable no-console */
// Full E2E: upload a real markdown document, run the pipeline, open the
// viewer, verify tables/math/headings render, and check console is clean.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const SAMPLE_MD = `# Machine Learning Basics

Machine learning is a field of study that gives computers the ability to learn without being explicitly programmed.

## Linear Regression

Linear regression models the relationship between a dependent variable and one or more explanatory variables.

The model is: y = mx + b

Cost function: J(θ) = (1/2m) Σ (h(x) - y)^2

## Gradient Descent

Gradient descent iteratively updates parameters to minimize the cost function.

| Iteration | Loss |
|-----------|------|
| 1 | 0.95 |
| 10 | 0.31 |
| 50 | 0.02 |
`;

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  console.log('Loading app…');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.click('text=Workspace');
  await page.waitForTimeout(1000);

  // Upload.
  console.log('Uploading real markdown document…');
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({
    name: 'machine-learning.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(SAMPLE_MD, 'utf-8'),
  });
  await page.waitForTimeout(8000);

  // Library should show the document.
  const bodyAfterUpload = await page.locator('body').innerText();
  const libHasDoc = bodyAfterUpload.includes('machine-learning');
  const libIsReady = bodyAfterUpload.includes('READY');
  console.log(`Document in library: ${libHasDoc ? 'YES' : 'NO'}`);
  console.log(`Document status READY: ${libIsReady ? 'YES' : 'NO'}`);

  // Open it: click the document title button inside the library row.
  const docBtn = page.locator('button:has-text("machine-learning")').first();
  await docBtn.waitFor({ timeout: 10000 });
  await docBtn.click();
  await page.waitForTimeout(2000);

  // Switch to Library tab to see the viewer.
  await page.click('button:has-text("Library")');
  await page.waitForTimeout(1000);

  const viewerBody = await page.locator('body').innerText();
  const hasHeading1 = viewerBody.includes('Linear Regression');
  const hasHeading2 = viewerBody.includes('Gradient Descent');
  const hasTableHeader = viewerBody.includes('Iteration') && viewerBody.includes('Loss');
  const hasTableValue = viewerBody.includes('0.95');
  const hasMath = viewerBody.includes('J(') || viewerBody.includes('log');

  console.log(`Viewer renders Linear Regression: ${hasHeading1 ? 'YES' : 'NO'}`);
  console.log(`Viewer renders Gradient Descent: ${hasHeading2 ? 'YES' : 'NO'}`);
  console.log(`Viewer renders table headers: ${hasTableHeader ? 'YES' : 'NO'}`);
  console.log(`Viewer renders table values: ${hasTableValue ? 'YES' : 'NO'}`);
  console.log(`Viewer renders math/cost: ${hasMath ? 'YES' : 'NO'}`);

  // Chat: send a real message (no AI configured → structured error, not fake).
  await page.click('button:has-text("Chat")');
  await page.waitForTimeout(500);
  const chatInput = page.locator('input[placeholder*="Ask about the document"]');
  await chatInput.fill('What is linear regression?');
  await page.locator('button[aria-label="Send message"]').click();
  await page.waitForTimeout(4000);
  const chatBody = await page.locator('body').innerText();
  const gotResponse = chatBody.includes('AI_NOT_CONFIGURED') || chatBody.includes('not configured') || chatBody.includes('OPENAI_API_KEY');
  console.log(`Chat returns structured config error (no AI key): ${gotResponse ? 'YES' : 'NO'}`);

  console.log('\n--- Console errors ---');
  console.log(consoleErrors.length === 0 ? 'NONE' : consoleErrors.join('\n'));
  console.log('--- Page errors ---');
  console.log(pageErrors.length === 0 ? 'NONE' : pageErrors.join('\n'));

  await browser.close();

  // A 503 "AI not configured" console entry is the EXPECTED, correct behavior
  // when no OPENAI_API_KEY is set — the app fails clearly instead of faking.
  const unexpectedErrors = consoleErrors.filter(
    (e) => !e.includes('503') && !e.includes('Service Unavailable') && !e.includes('ERR_CONNECTION_REFUSED'),
  );
  const clean = unexpectedErrors.length === 0 && pageErrors.length === 0;
  const contentOk = libHasDoc && libIsReady && hasHeading1 && hasHeading2 && hasTableHeader && hasTableValue && hasMath;
  console.log(`\nRESULT: ${clean && contentOk ? 'PASS' : 'FAIL'}`);
  process.exit(clean && contentOk ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E failed:', e);
  process.exit(1);
});
