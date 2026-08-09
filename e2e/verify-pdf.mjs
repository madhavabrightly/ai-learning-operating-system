/* eslint-disable no-console */
// E2E: generate a REAL PDF (via Chrome print-to-PDF) containing math and a
// table, upload it, verify the pipeline, viewer math/table rendering, search,
// notes, and console cleanliness.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function makePdf() {
  // Use headless Chrome to render HTML with math + a table into a real PDF.
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: serif; font-size: 14px; }
    h1 { font-size: 22px; } h2 { font-size: 17px; }
    table { border-collapse: collapse; } td, th { border: 1px solid #333; padding: 4px 8px; }
    .formula { font-style: italic; text-align: center; margin: 12px 0; font-size: 15px; }
  </style></head><body>
    <h1>Calculus Fundamentals</h1>
    <p>Calculus is the mathematical study of continuous change. The two main branches are differential calculus and integral calculus.</p>
    <h2>The Derivative</h2>
    <p>The derivative measures the rate of change of a function. For a function f(x), the derivative is defined as the limit of the difference quotient.</p>
    <p class="formula">f'(x) = lim(h → 0) [f(x + h) - f(x)] / h</p>
    <p>The derivative of x^n with respect to x is n * x^(n-1).</p>
    <h2>Table of Derivatives</h2>
    <table>
      <tr><th>Function</th><th>Derivative</th></tr>
      <tr><td>x^n</td><td>n x^(n-1)</td></tr>
      <tr><td>sin(x)</td><td>cos(x)</td></tr>
      <tr><td>e^x</td><td>e^x</td></tr>
    </table>
    <h2>Integration</h2>
    <p>Integration computes the area under a curve. It is the inverse operation of differentiation.</p>
    <p class="formula">∫ x^n dx = x^(n+1) / (n+1) + C</p>
  </body></html>`;
  await page.setContent(html);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return pdf;
}

async function main() {
  const pdfBytes = await makePdf();
  console.log(`Generated real PDF (${pdfBytes.length} bytes)`);

  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  console.log('Loading app…');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.click('text=Workspace');
  await page.waitForTimeout(1000);

  console.log('Uploading real PDF…');
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: 'calculus.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
  await page.waitForTimeout(15000);

  const bodyAfterUpload = await page.locator('body').innerText();
  const libHasDoc = bodyAfterUpload.includes('calculus');
  const libIsReady = bodyAfterUpload.includes('READY');
  console.log(`PDF in library: ${libHasDoc ? 'YES' : 'NO'}`);
  console.log(`PDF status READY: ${libIsReady ? 'YES' : 'NO'}`);

  // Open the document.
  const docBtn = page.locator('button:has-text("calculus")').first();
  await docBtn.waitFor({ timeout: 10000 });
  await docBtn.click();
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Library")');
  await page.waitForTimeout(1000);

  const viewerBody = await page.locator('body').innerText();
  const hasDerivative = viewerBody.includes('Derivative');
  const hasTableHeader = viewerBody.includes('Function') && viewerBody.includes('Derivative');
  const hasTableValue = viewerBody.includes('sin') && viewerBody.includes('cos');
  const hasMath = viewerBody.includes('lim') || viewerBody.includes('f(') || viewerBody.includes('∫') || viewerBody.includes('formula');
  console.log(`Viewer renders Derivative heading: ${hasDerivative ? 'YES' : 'NO'}`);
  console.log(`Viewer renders table headers: ${hasTableHeader ? 'YES' : 'NO'}`);
  console.log(`Viewer renders table values: ${hasTableValue ? 'YES' : 'NO'}`);
  console.log(`Viewer renders math: ${hasMath ? 'YES' : 'NO'}`);

  // Search must find real content.
  console.log('Searching for "derivative"…');
  await page.fill('input[placeholder*="Search in document"]', 'derivative');
  await page.waitForTimeout(1000);
  const searchBody = await page.locator('body').innerText();
  const searchWorked = searchBody.includes('derivative') && searchBody.includes('Page 1');
  console.log(`Search finds content with page: ${searchWorked ? 'YES' : 'NO'}`);

  // Notes must persist.
  console.log('Creating a note…');
  await page.click('button:has-text("Notes")');
  await page.waitForTimeout(500);
  await page.fill('input[placeholder*="Write a note"]', 'Remember the power rule for derivatives.');
  await page.locator('button[aria-label*="Delete note"]').first().waitFor({ timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const notesBody = await page.locator('body').innerText();
  const noteCreated = notesBody.includes('Remember the power rule');
  console.log(`Note created and listed: ${noteCreated ? 'YES' : 'NO'}`);

  console.log('\n--- Console errors ---');
  console.log(consoleErrors.length === 0 ? 'NONE' : consoleErrors.join('\n'));
  console.log('--- Page errors ---');
  console.log(pageErrors.length === 0 ? 'NONE' : pageErrors.join('\n'));

  await browser.close();

  const unexpectedErrors = consoleErrors.filter(
    (e) => !e.includes('503') && !e.includes('Service Unavailable') && !e.includes('ERR_CONNECTION_REFUSED'),
  );
  const clean = unexpectedErrors.length === 0 && pageErrors.length === 0;
  const contentOk = libHasDoc && libIsReady && hasDerivative && hasTableHeader && hasTableValue && hasMath && searchWorked && noteCreated;
  console.log(`\nRESULT: ${clean && contentOk ? 'PASS' : 'FAIL'}`);
  process.exit(clean && contentOk ? 0 : 1);
}

main().catch((e) => { console.error('E2E failed:', e); process.exit(1); });
