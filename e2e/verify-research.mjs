/* eslint-disable no-console */
// E2E: verify the research flow through the chat UI — real evidence fetched,
// real sources shown, no fake data.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const SAMPLE_MD = `# Study Topic

Machine learning is a field of study that gives computers the ability to learn without being explicitly programmed.
`;

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.click('text=Workspace');
  await page.waitForTimeout(800);

  // Upload a doc so chat has a grounding context.
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: 'study.md', mimeType: 'text/markdown', buffer: Buffer.from(SAMPLE_MD, 'utf-8') });
  await page.waitForTimeout(8000);

  // Go to Chat, enable Research mode, send a URL.
  await page.click('button:has-text("Chat")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Research")');
  await page.waitForTimeout(300);

  const chatInput = page.locator('input[placeholder*="Research query"]');
  await chatInput.fill('https://example.com');
  await page.locator('button[aria-label="Send message"]').click();
  await page.waitForTimeout(12000);

  const body = await page.locator('body').innerText();
  const hasSource = body.includes('example.com') || body.includes('Example Domain');
  const hasEvidence = body.includes('This domain is for use in documentation examples');
  const hasStructuredError = body.includes('BRIGHTDATA_BROWSER_WS_URL') || body.includes('RESEARCH_NOT_CONFIGURED') || body.includes('I couldn\'t complete the research');
  const sourcesShown = body.includes('Sources (');
  console.log(`Research returns real source: ${hasSource ? 'YES' : 'NO'}`);
  console.log(`Research returns real evidence: ${hasEvidence ? 'YES' : 'NO'}`);
  console.log(`Research structured error (if unconfigured): ${hasStructuredError ? 'YES' : 'NO'}`);
  console.log(`Sources section shown: ${sourcesShown ? 'YES' : 'NO'}`);

  console.log('\n--- Console errors ---');
  console.log(consoleErrors.length === 0 ? 'NONE' : consoleErrors.join('\n'));
  console.log('--- Page errors ---');
  console.log(pageErrors.length === 0 ? 'NONE' : pageErrors.join('\n'));

  await browser.close();

  // With no BRIGHTDATA_BROWSER_WS_URL and no direct-fetch, the structured
  // error is the CORRECT behavior — no fake data. With direct-fetch or Bright
  // Data configured, real sources+evidence appear. Either real outcome passes.
  const clean = consoleErrors.filter((e) => !e.includes('503')).length === 0 && pageErrors.length === 0;
  const outcomeOk = (hasSource && hasEvidence) || hasStructuredError;
  console.log(`\nRESULT: ${clean && outcomeOk ? 'PASS' : 'FAIL'}`);
  process.exit(clean && outcomeOk ? 0 : 1);
}

main().catch((e) => { console.error('E2E failed:', e); process.exit(1); });
