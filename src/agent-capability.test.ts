import { describe, expect, test } from 'bun:test';
import { agentDigest, agentPublicKeyDigest, createAgentProof, decryptAgentHandoff, encryptAgentHandoff, mintAgentCapability, verifyAgentCapability, verifyAgentProof, type AgentCapabilityClaims } from './agent-capability';

const secret = 'local-test-secret-with-sufficient-entropy';
const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_agents', arguments: {} } });

async function fixture(ttlMs = 60_000) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const now = Date.now();
  const claims: AgentCapabilityClaims = { iss: 'https://chat.ax.local', sub: 'owner', aud: 'chat-ax-agent', room: 'main', agent: 'root', operation: 'fleet.read', requestDigest: await agentDigest(raw), jti: crypto.randomUUID(), nonce: crypto.randomUUID(), publicKey, cnf: await agentPublicKeyDigest(publicKey), iat: now, exp: now + ttlMs };
  return { keys, claims, envelope: await mintAgentCapability(claims, secret) };
}

describe('agent proof-of-possession capability', () => {
  test('binds capability to key, request, scope, lifetime, and revocation', async () => {
    const { keys, envelope } = await fixture();
    const claims = await verifyAgentCapability(envelope.capability, secret, async () => false);
    const proof = await createAgentProof(envelope.capability, claims, keys.privateKey, 'POST', '/mcp', raw);
    const request = new Request('https://chat.ax.local/mcp', { method: 'POST', headers: { dpop: proof } });
    await expect(verifyAgentProof(request, raw, envelope.capability, claims)).resolves.toBeUndefined();
    const wrongPath = new Request('https://chat.ax.local/mcp?wrong=1', { method: 'POST', headers: { dpop: proof } });
    await expect(verifyAgentProof(wrongPath, raw, envelope.capability, claims)).rejects.toThrow();
    const thief = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const stolenProof = await createAgentProof(envelope.capability, claims, thief.privateKey, 'POST', '/mcp', raw);
    await expect(verifyAgentProof(new Request('https://chat.ax.local/mcp', { method: 'POST', headers: { dpop: stolenProof } }), raw, envelope.capability, claims)).rejects.toThrow();
    await expect(verifyAgentCapability(envelope.capability, secret, async () => true)).rejects.toThrow();
    await expect(verifyAgentCapability(envelope.capability, secret, async () => false, claims.exp)).rejects.toThrow();
  });

  test('encrypts the capability handoff to the external agent key', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
    const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const encrypted = await encryptAgentHandoff({ authority: 'private' }, publicKey);
    expect(JSON.stringify(encrypted)).not.toContain('private');
    expect(await decryptAgentHandoff(encrypted, keys.privateKey)).toEqual({ authority: 'private' });
  });
});
