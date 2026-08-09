/* eslint-disable no-console */
// E2E: verify the NEW features — knowledge graph UI, quiz generation,
// flashcards, and session save/restore — all with real document content.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const SAMPLE_MD = `# Machine Learning Basics

Machine learning is a field of study that gives computers the ability to learn without being explicitly programmed.

## Linear Regression

Linear regression models the relationship between a dependent variable and one or more explanatory variables.

## Gradient Descent

Gradient descent iteratively updates parameters to minimize the cost function.

## Neural Networks

Neural networks are composed of layers of neurons that transform inputs into outputs.

| Algorithm | Use |
|-----------|-----|
| Linear Regression | Prediction |
| Gradient Descent | Optimization |
`;

async function main() {
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
  await page.waitForTimeout(800);

  // Upload.
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: 'ml.md', mimeType: 'text/markdown', buffer: Buffer.from(SAMPLE_MD, 'utf-8') });
  await page.waitForTimeout(9000);

  // Open the document (title is the file name without extension).
  const docBtn = page.locator('button:has-text("ml")').first();
  await docBtn.waitFor({ timeout: 10000 });
  await docBtn.click();
  await page.waitForTimeout(1500);

  // --- Knowledge Graph ---
  console.log('\n=== Knowledge Graph ===');
  await page.click('button:has-text("Graph")');
  await page.waitForTimeout(3000);

  const graphBody = await page.locator('body').innerText();
  const graphLoaded = graphBody.includes('Linear') || graphBody.includes('regression') || graphBody.includes('Gradient');
  console.log(`Graph loads concepts from document: ${graphLoaded ? 'YES' : 'NO'}`);

  // Click a graph node.
  const nodeBtn = page.locator('button[title*="regression"], button[title*="gradient"], button[title*="learning"]').first();
  const hasNode = await nodeBtn.count();
  if (hasNode > 0) {
    await nodeBtn.click();
    await page.waitForTimeout(800);
    const detailBody = await page.locator('body').innerText();
    const hasDetail = detailBody.includes('Ask AI') || detailBody.includes('Source') || detailBody.includes('Related');
    console.log(`Graph node opens detail panel: ${hasDetail ? 'YES' : 'NO'}`);
  } else {
    console.log('Graph node opens detail panel: NO (no nodes found)');
  }

  // --- Study panel: quiz ---
  console.log('\n=== Quiz ===');
  await page.click('button:has-text("Study")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Generate")');
  await page.waitForTimeout(4000);

  let quizBody = await page.locator('body').innerText();
  const quizGenerated = /^1\. /m.test(quizBody) || quizBody.includes('Which of the following');
  console.log(`Quiz generated from content: ${quizGenerated ? 'YES' : 'NO'}`);

  if (quizGenerated) {
    // Answer a question.
    const optionBtn = page.locator('button:has-text("The text does not discuss this.")').first();
    if (await optionBtn.count()) {
      await optionBtn.click();
      await page.waitForTimeout(500);
      quizBody = await page.locator('body').innerText();
      console.log(`Quiz evaluates answer: ${quizBody.includes('Incorrect') || quizBody.includes('Correct') ? 'YES' : 'NO'}`);
    }
  }

  // --- Flashcards ---
  console.log('\n=== Flashcards ===');
  await page.click('button:has-text("flashcards")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Generate")');
  await page.waitForTimeout(5000);

  const flashBody = await page.locator('body').innerText();
  const flashGenerated = flashBody.toLowerCase().includes('click to flip') || flashBody.toLowerCase().includes('review');
  console.log(`Flashcards generated from content: ${flashGenerated ? 'YES' : 'NO'}`);

  // --- Session save/restore ---
  console.log('\n=== Session persistence ===');
  // Wait for the workspace session to persist, then reload.
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.click('text=Workspace');
  await page.waitForTimeout(2500);

  const restoredBody = await page.locator('body').innerText();
  const docRestored = restoredBody.includes('ml') && (restoredBody.includes('Linear') || restoredBody.includes('Machine'));
  console.log(`Document restored after refresh: ${docRestored ? 'YES' : 'NO'}`);
  if (!docRestored) {
    console.log('Restored body snippet:', restoredBody.slice(0, 800).replace(/\n/g, ' | '));
  }

  console.log('\n--- Console errors ---');
  console.log(consoleErrors.length === 0 ? 'NONE' : consoleErrors.join('\n'));
  console.log('--- Page errors ---');
  console.log(pageErrors.length === 0 ? 'NONE' : pageErrors.join('\n'));

  await browser.close();

  const unexpectedErrors = consoleErrors.filter(
    (e) => !e.includes('503') && !e.includes('Service Unavailable') && !e.includes('ERR_CONNECTION_REFUSED'),
  );
  const clean = unexpectedErrors.length === 0 && pageErrors.length === 0;
  const featuresOk = graphLoaded && hasNode > 0 && quizGenerated && flashGenerated && docRestored;
  console.log(`\nRESULT: ${clean && featuresOk ? 'PASS' : 'FAIL'}`);
  process.exit(clean && featuresOk ? 0 : 1);
}

main().catch((e) => { console.error('E2E failed:', e); process.exit(1); });
