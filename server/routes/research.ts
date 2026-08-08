import { Router } from 'express';
import { z } from 'zod';

const router = Router();

// ---------------------------------------------------------------------------
// Evidence model — every web-derived result must preserve provenance.
// ---------------------------------------------------------------------------

export interface ResearchEvidence {
  sourceId: string;
  url: string;
  title: string;
  domain: string;
  retrievedAt: number;
  relevantText: string;
  confidence: number;
  requestId: string;
}

export interface ResearchResult {
  requestId: string;
  query: string;
  evidence: ResearchEvidence[];
  mechanism: 'brightdata' | 'direct-fetch' | 'error';
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const researchSchema = z.object({
  query: z.string().min(1).max(500),
  url: z.string().url().optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
});

function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }
  return url;
}

export { assertSafeUrl };

// ---------------------------------------------------------------------------
// Bright Data browser research
// ---------------------------------------------------------------------------

function getBrightDataWsUrl(): string | undefined {
  const ws = process.env.BRIGHTDATA_BROWSER_WS_URL;
  return ws && ws.trim().length > 0 ? ws.trim() : undefined;
}

async function researchWithBrightData(query: string, url: string | undefined, maxResults: number, requestId: string): Promise<ResearchEvidence[]> {
  const wsUrl = getBrightDataWsUrl();
  if (!wsUrl) {
    throw new Error('BRIGHTDATA_BROWSER_WS_URL is not configured');
  }

  // Lazy require so the server works without playwright-core installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = await import('playwright-core');

  const evidence: ResearchEvidence[] = [];
  const browser = await chromium.connectOverCDP(wsUrl);
  try {
    const page = await browser.newPage();
    const target = url ?? buildSearchUrl(query);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1500);

    const title = (await page.title().catch(() => '')).slice(0, 300);
    const bodyText = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')) ?? '';

    const domain = (() => {
      try {
        return new URL(page.url()).hostname;
      } catch {
        return '';
      }
    })();

    // Extract meaningful paragraphs, dedupe, keep the most relevant ones.
    const paragraphs = bodyText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 80 && s.length < 2000);

    const ranked = rankParagraphs(paragraphs, query).slice(0, maxResults);

    for (let i = 0; i < ranked.length; i++) {
      evidence.push({
        sourceId: `${requestId}-src-${i + 1}`,
        url: page.url(),
        title: title || domain || 'Untitled page',
        domain,
        retrievedAt: Date.now(),
        relevantText: ranked[i]?.text ?? '',
        confidence: ranked[i]?.score ?? 0.5,
        requestId,
      });
    }

    // If the page was itself a direct answer to a URL request, capture it.
    if (url && evidence.length === 0 && bodyText.length > 0) {
      evidence.push({
        sourceId: `${requestId}-src-1`,
        url: page.url(),
        title: title || domain,
        domain,
        retrievedAt: Date.now(),
        relevantText: bodyText.slice(0, 3000),
        confidence: 0.6,
        requestId,
      });
    }

    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
  }

  return evidence;
}

function buildSearchUrl(query: string): string {
  const q = encodeURIComponent(query);
  return `https://www.google.com/search?q=${q}`;
}

function rankParagraphs(paragraphs: string[], query: string): { text: string; score: number }[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  return paragraphs
    .map((text) => {
      const lower = text.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (lower.includes(t)) score += 1;
      }
      return { text, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Direct fetch fallback (opt-in)
// ---------------------------------------------------------------------------

function isDirectFetchAllowed(): boolean {
  return process.env.RESEARCH_ALLOW_DIRECT_FETCH === '1';
}

async function researchWithDirectFetch(url: string, requestId: string): Promise<ResearchEvidence[]> {
  const parsed = assertSafeUrl(url);
  const res = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AI-Learning-OS/1.0; +research)',
      Accept: 'text/html,text/plain;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed with status ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();

  const title = extractTitle(text) || parsed.hostname;
  const bodyText = contentType.includes('html') ? extractTextFromHtml(text) : text;

  const paragraphs = bodyText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 80 && s.length < 4000);

  const kept = paragraphs.slice(0, 5);

  return [
    {
      sourceId: `${requestId}-src-1`,
      url: parsed.toString(),
      title,
      domain: parsed.hostname,
      retrievedAt: Date.now(),
      relevantText: kept.join('\n\n').slice(0, 12_000),
      confidence: 0.7,
      requestId,
    },
  ];
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? null;
}

export { extractTitle };

function extractTextFromHtml(html: string): string {
  // Strip scripts/styles, then tags.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/([.!?])\s+(?=[A-Z])/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n');
}

export { extractTextFromHtml };

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post('/', async (req, res) => {
  const parsed = researchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }

  const { query, url, maxResults } = parsed.data;
  const requestId = crypto.randomUUID();

  const result: ResearchResult = {
    requestId,
    query,
    evidence: [],
    mechanism: 'error',
  };

  try {
    if (getBrightDataWsUrl()) {
      result.evidence = await researchWithBrightData(query, url, maxResults ?? 5, requestId);
      result.mechanism = 'brightdata';
    } else if (url && isDirectFetchAllowed()) {
      result.evidence = await researchWithDirectFetch(url, requestId);
      result.mechanism = 'direct-fetch';
    } else {
      result.mechanism = 'error';
      result.error = {
        code: 'RESEARCH_NOT_CONFIGURED',
        message: url
          ? 'Neither BRIGHTDATA_BROWSER_WS_URL nor RESEARCH_ALLOW_DIRECT_FETCH=1 is configured for the local backend. For Bright Data, set BRIGHTDATA_BROWSER_WS_URL in server/.env.'
          : 'A URL is required for research. Provide a target URL, or configure BRIGHTDATA_BROWSER_WS_URL in server/.env so the backend can discover sources for you.',
      };
      res.status(503).json(result);
      return;
    }

    if (result.evidence.length === 0) {
      result.error = { code: 'NO_EVIDENCE', message: 'Research completed but no usable content was extracted.' };
    }

    res.json(result);
  } catch (e) {
    result.mechanism = 'error';
    result.error = {
      code: 'RESEARCH_FAILED',
      message: e instanceof Error ? e.message : 'Research failed',
    };
    res.status(502).json(result);
  }
});

export { router as researchRouter };
