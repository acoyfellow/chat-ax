import { afterEach, describe, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyAccessRequest } from './auth';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function accessTeam(issuer: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) =>
      String(input) === `${issuer}/cdn-cgi/access/certs` ? Response.json({ keys: [jwk] }) : new Response('not found', { status: 404 }),
    { preconnect: realFetch.preconnect },
  );
  return (claims: { aud: string; email: string; iss?: string }) =>
    new SignJWT({ email: claims.email })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(claims.iss ?? issuer)
      .setAudience(claims.aud)
      .setSubject(`user-${claims.email}`)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
}

const request = (token: string) => new Request('https://chat.example.workers.dev/', { headers: { 'Cf-Access-Jwt-Assertion': token } });

describe('Access verification', () => {
  test('forged tokens and tokens from another team are refused', async () => {
    await accessTeam('https://acme2.cloudflareaccess.com');
    const application = { issuer: 'https://acme2.cloudflareaccess.com', audience: 'aud' };
    const forged = new SignJWT({ email: 'x@y.z' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(application.issuer).setAudience('aud').setExpirationTime('5m');
    await expect(verifyAccessRequest(request(await forged.sign((await generateKeyPair('RS256')).privateKey)), {}, application)).rejects.toThrow();
    await expect(verifyAccessRequest(request('not.a.jwt'), {}, application)).rejects.toThrow();
    const otherTeam = await accessTeam('https://evil.cloudflareaccess.com');
    await expect(verifyAccessRequest(request(await otherTeam({ aud: 'aud', email: 'x@y.z' })), {}, application)).rejects.toThrow();
  });

  test('only the configured application is accepted', async () => {
    const sign = await accessTeam('https://acme3.cloudflareaccess.com');
    const application = { issuer: 'https://acme3.cloudflareaccess.com', audience: 'aud-locked' };
    const good = await sign({ aud: 'aud-locked', email: 'teammate@acme.com' });
    expect((await verifyAccessRequest(request(good), {}, application)).email).toBe('teammate@acme.com');
    const otherApp = await sign({ aud: 'aud-other', email: 'stranger@acme.com' });
    await expect(verifyAccessRequest(request(otherApp), {}, application)).rejects.toThrow();
  });

  test('without any application, every request is refused', async () => {
    const sign = await accessTeam('https://acme4.cloudflareaccess.com');
    await expect(verifyAccessRequest(request(await sign({ aud: 'a', email: 'x@y.z' })), {}, null)).rejects.toThrow('npm run setup');
  });
});
