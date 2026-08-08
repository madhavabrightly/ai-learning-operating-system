import { describe, it, expect } from 'vitest';
import { assertSafeUrl, extractTitle, extractTextFromHtml } from '../research';

describe('research route helpers', () => {
  it('rejects non-http(s) URLs', () => {
    expect(() => assertSafeUrl('file:///etc/passwd')).toThrow();
    expect(() => assertSafeUrl('javascript:alert(1)')).toThrow();
  });

  it('accepts http(s) URLs', () => {
    const url = assertSafeUrl('https://example.com/article');
    expect(url.hostname).toBe('example.com');
  });

  it('extracts the page title from raw HTML', () => {
    expect(extractTitle('<html><head><title>Hello World</title></head></html>')).toBe('Hello World');
    expect(extractTitle('<html><head></head></html>')).toBeNull();
  });

  it('strips scripts and tags from HTML into readable text', () => {
    const html = '<html><head><style>p{color:red}</style><script>alert(1)</script></head><body><p>First sentence. Second sentence.</p><p>Third.</p></body></html>';
    const text = extractTextFromHtml(html);
    expect(text).not.toContain('<');
    expect(text.toLowerCase()).toContain('first sentence');
    expect(text.toLowerCase()).toContain('third');
    // script content removed
    expect(text).not.toContain('alert');
  });
});
