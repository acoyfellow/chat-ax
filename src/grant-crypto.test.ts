import { describe, expect, test } from 'bun:test';
import { decryptGrant, encryptGrant } from './grant-crypto';

const masterKey = Buffer.alloc(32, 11).toString('base64');

describe('connector grant encryption', () => {
  test('decrypts only for the verified actor scope', async () => {
    const encrypted = await encryptGrant(masterKey, 'jordan', 'private-token');
    expect(encrypted).not.toContain('private-token');
    expect(await decryptGrant(masterKey, 'jordan', encrypted)).toBe('private-token');
    await expect(decryptGrant(masterKey, 'sam', encrypted)).rejects.toThrow();
  });

  test('uses a fresh ciphertext for each stored value', async () => {
    const first = await encryptGrant(masterKey, 'jordan', 'same-token');
    const second = await encryptGrant(masterKey, 'jordan', 'same-token');
    expect(first).not.toBe(second);
  });
});
