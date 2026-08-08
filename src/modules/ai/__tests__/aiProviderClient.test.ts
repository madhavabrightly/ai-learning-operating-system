import { describe, it, expect, vi } from 'vitest';
import { BackendHttpClient } from '@/services/BackendClient';
import { createAiProviderClient } from '../AiProviderClient';
import { AppError } from '@/errors/AppError';

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; body?: ReadableStream | null }>) {
  return vi.fn(async (url: string, init?: RequestInit) => handler(url, init)) as unknown as typeof fetch;
}

describe('AiProviderClient', () => {
  it('posts chat messages to the backend and returns the response', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ role: 'assistant', content: 'Hello!' }),
    }));

    const client = new BackendHttpClient({ baseUrl: 'http://localhost:8787', fetchImpl });
    const ai = createAiProviderClient(client, fetchImpl);

    const res = await ai.chat({
      conversationId: 'c1',
      messages: [{ role: 'user', content: 'Hi' }],
      context: { documentId: 'd1' },
    });

    expect(res.content).toBe('Hello!');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/api/ai/chat');
    expect(JSON.parse(String(init.body))).toMatchObject({ conversationId: 'c1' });
  });

  it('surfaces backend structured errors as AppError', async () => {
    const fetchImpl = mockFetch(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: 'AI_NOT_CONFIGURED', message: 'Set OPENAI_API_KEY' } }),
    }));

    const client = new BackendHttpClient({ baseUrl: 'http://localhost:8787', fetchImpl });
    const ai = createAiProviderClient(client, fetchImpl);

    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      message: 'Set OPENAI_API_KEY',
    });
  });

  it('streams SSE deltas from the backend', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"delta":"Hel"}\n\n'),
      encoder.encode('data: {"delta":"lo"}\n\n'),
      encoder.encode('event: done\ndata: {}\n\n'),
    ];
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]!);
        else controller.close();
      },
    });

    const fetchImpl = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: stream,
    }));

    const client = new BackendHttpClient({ baseUrl: 'http://localhost:8787', fetchImpl });
    const ai = createAiProviderClient(client, fetchImpl);

    const deltas: string[] = [];
    let done = false;
    await ai.streamChat({ messages: [{ role: 'user', content: 'x' }] }, {
      onDelta: (d) => deltas.push(d),
      onDone: () => {
        done = true;
      },
    });

    expect(deltas.join('')).toBe('Hello');
    expect(done).toBe(true);
  });
});

describe('AppError structured errors', () => {
  it('carries code, retryable and fallback flags', () => {
    const e = new AppError({ message: 'x', code: 'NETWORK_ERROR', retryable: true, fallbackAvailable: true });
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.retryable).toBe(true);
    expect(e.fallbackAvailable).toBe(true);
  });
});
