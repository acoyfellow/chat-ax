import { z } from 'zod';

export type AgentCapabilityClaims = {
  iss: string;
  sub: string;
  aud: 'chat-ax-agent';
  room: string;
  agent: string;
  operation: string;
  requestDigest: string;
  jti: string;
  nonce: string;
  publicKey: JsonWebKey;
  cnf: string;
  iat: number;
  exp: number;
};

export type AgentCapabilityEnvelope = {
  capability: string;
  claims: Pick<AgentCapabilityClaims, 'jti' | 'nonce' | 'exp'>;
};

export type EncryptedAgentHandoff = {
  wrappedKey: string;
  iv: string;
  ciphertext: string;
};

const publicKeySchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().min(1).max(100), y: z.string().min(1).max(100) }).passthrough();
const agentCapabilityClaimsSchema = z.object({ iss: z.string().min(1).max(512), sub: z.string().min(1).max(512), aud: z.literal('chat-ax-agent'), room: z.string().min(1).max(512), agent: z.string().min(1).max(512), operation: z.string().min(1).max(512), requestDigest: z.string().min(1).max(512), jti: z.string().min(1).max(512), nonce: z.string().min(1).max(512), publicKey: publicKeySchema, cnf: z.string().min(1).max(512), iat: z.number().int().safe(), exp: z.number().int().safe() });
const agentProofSchema = z.object({ capabilityDigest: z.string(), method: z.string(), path: z.string(), bodyDigest: z.string(), nonce: z.string(), signature: z.string() });

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64Encode = (value: BufferSource): string => {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
};
const base64Decode = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0));
export const agentDigest = async (value: string | BufferSource): Promise<string> => base64Encode(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value));
export const agentPublicKeyDigest = async (value: JsonWebKey): Promise<string> => {
  const key = publicKeySchema.parse(value);
  return agentDigest(JSON.stringify({ kty: key.kty, crv: key.crv, x: key.x, y: key.y }));
};
const signingKey = (secret: string) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function mintAgentCapability(claims: AgentCapabilityClaims, secret: string): Promise<AgentCapabilityEnvelope> {
  if (claims.aud !== 'chat-ax-agent' || claims.exp <= claims.iat || claims.exp - claims.iat > 60_000) throw new Error('Invalid capability lifetime');
  const payload = base64Encode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return { capability: `${payload}.${base64Encode(signature)}`, claims: { jti: claims.jti, nonce: claims.nonce, exp: claims.exp } };
}

export async function verifyAgentCapability(token: string | null, secret: string, revoked: (jti: string) => Promise<boolean>, now = Date.now(), expectedIssuer?: string): Promise<AgentCapabilityClaims> {
  const [payload, signature, extra] = token?.split('.') ?? [];
  if (!payload || !signature || extra) throw new Error('Invalid agent capability');
  const valid = await crypto.subtle.verify('HMAC', await signingKey(secret), base64Decode(signature), encoder.encode(payload));
  if (!valid) throw new Error('Invalid agent capability');
  const claims = agentCapabilityClaimsSchema.parse(JSON.parse(decoder.decode(base64Decode(payload))));
  if ((expectedIssuer && claims.iss !== expectedIssuer) || claims.exp <= now || claims.iat > now + 1_000 || claims.exp - claims.iat > 60_000 || await revoked(claims.jti)) throw new Error('Invalid agent capability');
  return claims;
}

export async function verifyAgentProof(request: Request, raw: string, capability: string, claims: AgentCapabilityClaims): Promise<void> {
  const encoded = request.headers.get('dpop');
  if (!encoded) throw new Error('Missing agent proof');
  const proof = agentProofSchema.parse(JSON.parse(decoder.decode(base64Decode(encoded))));
  const { signature } = proof;
  const signed = { capabilityDigest: proof.capabilityDigest, method: proof.method, path: proof.path, bodyDigest: proof.bodyDigest, nonce: proof.nonce };
  const url = new URL(request.url);
  const expected = { capabilityDigest: await agentDigest(capability), method: request.method, path: `${url.pathname}${url.search}`, bodyDigest: await agentDigest(raw), nonce: claims.nonce };
  if (JSON.stringify(signed) !== JSON.stringify(expected)) throw new Error('Agent proof mismatch');
  if (await agentPublicKeyDigest(claims.publicKey) !== claims.cnf) throw new Error('Agent key mismatch');
  const key = await crypto.subtle.importKey('jwk', claims.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64Decode(signature), encoder.encode(JSON.stringify(signed)));
  if (!valid) throw new Error('Invalid agent proof');
}

export async function encryptAgentHandoff(value: unknown, publicKey: JsonWebKey): Promise<EncryptedAgentHandoff> {
  const wrappingKey = await crypto.subtle.importKey('jwk', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const contentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rawKey = await crypto.subtle.exportKey('raw', contentKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, encoder.encode(JSON.stringify(value)));
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, wrappingKey, rawKey);
  return { wrappedKey: base64Encode(wrappedKey), iv: base64Encode(iv), ciphertext: base64Encode(ciphertext) };
}

export async function decryptAgentHandoff(value: EncryptedAgentHandoff, privateKey: CryptoKey): Promise<unknown> {
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, base64Decode(value.wrappedKey));
  const contentKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64Decode(value.iv) }, contentKey, base64Decode(value.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}

export async function createAgentProof(capability: string, claims: Pick<AgentCapabilityClaims, 'nonce'>, key: CryptoKey, method: string, path: string, raw: string): Promise<string> {
  const signed = { capabilityDigest: await agentDigest(capability), method, path, bodyDigest: await agentDigest(raw), nonce: claims.nonce };
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(JSON.stringify(signed)));
  return base64Encode(encoder.encode(JSON.stringify({ ...signed, signature: base64Encode(signature) })));
}
