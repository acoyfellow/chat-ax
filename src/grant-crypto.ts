const VERSION = 'v1';
const KEY_INFO = new TextEncoder().encode('chat-ax-connector-token-v1');

function bytesToBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function encode(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
}

function decode(value: string): Uint8Array {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(standard + '='.repeat((4 - (standard.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function userKey(masterKey: string, actorId: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = decode(masterKey.replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_'));
  if (raw.length < 32) throw new Error('MASTER_KEY must contain at least 32 bytes');
  const imported = await crypto.subtle.importKey(
    'raw',
    bytesToBuffer(raw),
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );
  const actor = new TextEncoder().encode(actorId);
  const info = new Uint8Array(KEY_INFO.length + actor.length + 1);
  info.set(KEY_INFO);
  info[KEY_INFO.length] = 0;
  info.set(actor, KEY_INFO.length + 1);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bytesToBuffer(salt),
      info: bytesToBuffer(info),
    },
    imported,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptGrant(
  masterKey: string,
  actorId: string,
  plaintext: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await userKey(masterKey, actorId, salt);
  const additionalData = new TextEncoder().encode(`${VERSION}|${actorId}`);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: bytesToBuffer(iv),
      additionalData: bytesToBuffer(additionalData),
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(plaintext),
  );
  return [VERSION, encode(salt), encode(iv), encode(new Uint8Array(ciphertext))].join('.');
}

export async function decryptGrant(
  masterKey: string,
  actorId: string,
  encrypted: string,
): Promise<string> {
  const [version, saltValue, ivValue, ciphertextValue, extra] = encrypted.split('.');
  if (version !== VERSION || !saltValue || !ivValue || !ciphertextValue || extra) {
    throw new Error('Invalid encrypted grant');
  }
  const salt = decode(saltValue);
  const iv = decode(ivValue);
  const ciphertext = decode(ciphertextValue);
  const key = await userKey(masterKey, actorId, salt);
  const additionalData = new TextEncoder().encode(`${VERSION}|${actorId}`);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytesToBuffer(iv),
      additionalData: bytesToBuffer(additionalData),
      tagLength: 128,
    },
    key,
    bytesToBuffer(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
