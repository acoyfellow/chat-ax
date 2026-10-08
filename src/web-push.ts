import { SignJWT, importJWK } from 'jose';
import type { StoredPushSubscription } from './shared-features';

export type PushCredentials = {
  subject?: string;
  publicKey?: string;
  privateKey?: string;
};

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function combine(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    exactBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, exactBuffer(data)));
}

async function expand(key: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  return (await hmac(key, combine(info, new Uint8Array([1])))).slice(0, length);
}

async function authorization(endpoint: string, credentials: Required<PushCredentials>) {
  const publicBytes = decodeBase64Url(credentials.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error('invalid VAPID key');
  const signingKey = await importJWK(
    {
      kty: 'EC',
      crv: 'P-256',
      x: encodeBase64Url(publicBytes.slice(1, 33)),
      y: encodeBase64Url(publicBytes.slice(33, 65)),
      d: credentials.privateKey,
    },
    'ES256',
  );
  const token = await new SignJWT({})
    .setProtectedHeader({ typ: 'JWT', alg: 'ES256' })
    .setAudience(new URL(endpoint).origin)
    .setSubject(credentials.subject)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 12 * 60 * 60)
    .sign(signingKey);
  return `vapid t=${token}, k=${credentials.publicKey}`;
}

async function encryptedBody(
  subscription: StoredPushSubscription['subscription'],
  payload: Uint8Array,
): Promise<Uint8Array> {
  const clientPublic = decodeBase64Url(subscription.keys.p256dh);
  const authSecret = decodeBase64Url(subscription.keys.auth);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4 || authSecret.length === 0)
    throw new Error('invalid push subscription');
  const clientKey = await crypto.subtle.importKey(
    'raw',
    exactBuffer(clientPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, local.privateKey, 256),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const authKey = await hmac(authSecret, shared);
  const inputKey = await expand(
    authKey,
    combine(encoder.encode('WebPush: info\0'), clientPublic, localPublic),
    32,
  );
  const pseudoKey = await hmac(salt, inputKey);
  const contentKey = await expand(pseudoKey, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expand(pseudoKey, encoder.encode('Content-Encoding: nonce\0'), 12);
  const plaintext = combine(payload, new Uint8Array([2]));
  if (plaintext.length > 4080) throw new Error('push payload is too large');
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    exactBuffer(contentKey),
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt'],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: exactBuffer(nonce) },
      encryptionKey,
      exactBuffer(plaintext),
    ),
  );
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return combine(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, ciphertext);
}

function allowedPushHost(hostname: string): boolean {
  return (
    hostname === 'fcm.googleapis.com' ||
    hostname === 'updates.push.services.mozilla.com' ||
    hostname === 'push.services.mozilla.com' ||
    hostname === 'web.push.apple.com' ||
    hostname.endsWith('.notify.windows.com')
  );
}

function completeCredentials(credentials: PushCredentials): Required<PushCredentials> | null {
  return credentials.subject && credentials.publicKey && credentials.privateKey
    ? {
        subject: credentials.subject,
        publicKey: credentials.publicKey,
        privateKey: credentials.privateKey,
      }
    : null;
}

export async function sendWebPush(
  credentials: PushCredentials,
  subscription: StoredPushSubscription['subscription'],
  data: { title: string; body: string; href: string; notificationId: string },
  transport: typeof fetch = fetch,
): Promise<boolean> {
  const complete = completeCredentials(credentials);
  if (!complete) return false;
  const endpoint = new URL(subscription.endpoint);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    !allowedPushHost(endpoint.hostname)
  )
    return false;
  const body = await encryptedBody(subscription, new TextEncoder().encode(JSON.stringify(data)));
  const response = await transport(endpoint, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: await authorization(subscription.endpoint, complete),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '300',
    },
    body: exactBuffer(body),
  });
  return response.ok;
}
