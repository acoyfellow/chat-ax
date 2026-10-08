import { z } from 'zod';

export const jsonLimits = {
  bytes: 256 * 1024,
  depth: 16,
  objectKeys: 100,
  keyLength: 200,
  stringLength: 32_000,
  arrayLength: 500,
} as const;

export function validateJsonStructure(value: unknown, limits = jsonLimits): void {
  const visit = (current: unknown, depth: number): void => {
    if (depth > limits.depth) throw new Error('JSON nesting limit exceeded');
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('JSON number must be finite');
      return;
    }
    if (typeof current === 'string') {
      if (current.length > limits.stringLength) throw new Error('JSON string limit exceeded');
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > limits.arrayLength) throw new Error('JSON array limit exceeded');
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current === 'object') {
      const entries = Object.entries(current);
      if (entries.length > limits.objectKeys) throw new Error('JSON object key limit exceeded');
      for (const [key, item] of entries) {
        if (key.length > limits.keyLength) throw new Error('JSON key limit exceeded');
        visit(item, depth + 1);
      }
      return;
    }
    throw new Error('Unsupported JSON value');
  };
  visit(value, 0);
}

type ReadableBody = Pick<Request, 'body' | 'headers'> | Pick<Response, 'body' | 'headers'>;

export async function readBoundedText(
  source: ReadableBody,
  maximumBytes = jsonLimits.bytes,
): Promise<string> {
  const declared = Number(source.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes)
    throw new Error('Body byte limit exceeded');
  if (!source.body) return '';
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel('Body byte limit exceeded');
      throw new Error('Body byte limit exceeded');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readBoundedJson(
  request: Request,
  maximumBytes = jsonLimits.bytes,
): Promise<unknown> {
  if (!request.body) throw new SyntaxError('Unexpected end of JSON input');
  const value: unknown = JSON.parse(await readBoundedText(request, maximumBytes));
  validateJsonStructure(value);
  return value;
}

export async function parseBoundedJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maximumBytes = jsonLimits.bytes,
): Promise<T> {
  return schema.parse(await readBoundedJson(request, maximumBytes));
}

export function cloneRequest(request: Request): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.clone().body,
  });
}
