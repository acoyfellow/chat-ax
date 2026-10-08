import { describe, expect, test } from 'bun:test';
import { readBoundedJson, readBoundedText, validateJsonStructure } from './safe-json';

describe('bounded recursive JSON', () => {
  test('rejects malicious nesting and oversized collections', () => {
    let nested: unknown = null;
    for (let index = 0; index < 18; index += 1) nested = [nested];
    expect(() => validateJsonStructure(nested)).toThrow('nesting');
    expect(() => validateJsonStructure(Array.from({ length: 501 }, () => null))).toThrow('array');
    expect(() =>
      validateJsonStructure(
        Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`key-${index}`, null])),
      ),
    ).toThrow('object');
  });

  test('rejects oversized bodies and non-finite numbers', async () => {
    const request = new Request('https://agent/context', {
      method: 'PUT',
      body: JSON.stringify({ value: 'x'.repeat(300_000) }),
    });
    await expect(readBoundedJson(request)).rejects.toThrow('byte');
    expect(() => validateJsonStructure(Number.POSITIVE_INFINITY)).toThrow('finite');
  });

  test('cancels a chunked body as soon as its byte limit is exceeded', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(6));
        if (pulls === 3) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://agent/context', { method: 'PUT', body });
    await expect(readBoundedJson(request, 10)).rejects.toThrow('byte');
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });

  test('preserves exact raw text across streamed UTF-8 chunks', async () => {
    const encoded = new TextEncoder().encode('{"proof":"é"}');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, encoded.length - 2));
        controller.enqueue(encoded.slice(encoded.length - 2));
        controller.close();
      },
    });
    const request = new Request('https://agent/proof', { method: 'POST', body });
    await expect(readBoundedText(request, encoded.length)).resolves.toBe('{"proof":"é"}');
  });

  test('rejects declared oversized raw text before reading the stream', async () => {
    const request = new Request('https://agent/proof', {
      method: 'POST',
      headers: { 'content-length': '11' },
      body: 'small',
    });
    await expect(readBoundedText(request, 10)).rejects.toThrow('byte');
  });

  test('rejects a request with no body', async () => {
    await expect(readBoundedJson(new Request('https://agent/context'))).rejects.toThrow(
      'Unexpected end',
    );
  });
});
