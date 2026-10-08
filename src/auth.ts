import type { MiddlewareHandler } from 'hono';
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';
import * as v from 'valibot';

export interface AccessIdentity {
  email: string;
  sub: string;
  name?: string;
  groups?: string[];
  avatarUrl?: string;
}

export interface AuthEnv {
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ISS?: string;
  ENVIRONMENT?: string;
  DEV_USER_EMAIL?: string;
  DEV_USER_NAME?: string;
  DEV_USER_GROUPS?: string;
  MINIFLARE?: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class AccessError extends Error {
  constructor(
    public tag: string,
    message: string,
  ) {
    super(message);
  }
}

function normalizeAccessIssuer(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export type AccessApplication = { issuer: string; audience: string };

export function configuredAccessApplication(env: AuthEnv): AccessApplication | null {
  const issuer = normalizeAccessIssuer(env.CF_ACCESS_ISS);
  const audience = env.CF_ACCESS_AUD?.trim();
  return issuer && audience ? { issuer, audience } : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isStringArray(value: unknown): value is string[] {
  return v.is(v.array(v.string()), value);
}

function verifiedName(payload: JWTPayload): string | undefined {
  if (isNonEmptyString(payload.name)) return payload.name.trim();
  if (isNonEmptyString(payload.common_name)) return payload.common_name.trim();
  const given = isNonEmptyString(payload.given_name) ? payload.given_name.trim() : '';
  const family = isNonEmptyString(payload.family_name) ? payload.family_name.trim() : '';
  const combined = `${given} ${family}`.trim();
  return combined || undefined;
}

function isGoogleProfileImage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('googleusercontent.com');
  } catch {
    return false;
  }
}

function getJWKS(iss: string) {
  const cached = jwksCache.get(iss);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`${iss}/cdn-cgi/access/certs`));
  jwksCache.set(iss, jwks);
  return jwks;
}

export function isLocalDevBypassAllowed(req: Request, env: AuthEnv): boolean {
  const host = new URL(req.url).hostname.toLowerCase();
  const isLoopbackHost =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  const hasLocalRuntimeSignal =
    env.MINIFLARE === '1' ||
    env.MINIFLARE === 'true' ||
    req.headers.get('MF-Original-URL') !== null;
  return Boolean(
    env.ENVIRONMENT === 'dev' &&
      !env.CF_ACCESS_ISS &&
      !env.CF_ACCESS_AUD &&
      env.DEV_USER_EMAIL &&
      (isLoopbackHost || hasLocalRuntimeSignal),
  );
}

export async function verifyAccessRequest(req: Request, env: AuthEnv, application: AccessApplication | null = configuredAccessApplication(env)): Promise<AccessIdentity> {
  if (isLocalDevBypassAllowed(req, env)) {
    const configuredEmail = env.DEV_USER_EMAIL ?? '';
    const requestedEmail = req.headers.get('x-dev-user-email')?.trim().toLowerCase();
    const devUserEmail = requestedEmail?.endsWith('@example.com')
      ? requestedEmail
      : configuredEmail;
    const requestedName = req.headers.get('x-dev-user-name')?.trim();
    return {
      email: devUserEmail.toLowerCase(),
      sub: `dev-${devUserEmail}`,
      name: requestedName || env.DEV_USER_NAME?.trim() || undefined,
      groups: env.DEV_USER_GROUPS?.split(',').map((s) => s.trim()),
    };
  }

  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AccessError('NoAccessJwt', 'Missing Cf-Access-Jwt-Assertion header');

  try {
    if (!application) {
      throw new AccessError('AccessNotConfigured', 'Chat AX is not set up yet. Run npm run setup');
    }
    const { issuer, audience } = application;
    const { payload } = await jwtVerify(token, getJWKS(issuer), { issuer, audience });
    if (!isNonEmptyString(payload.email)) {
      throw new AccessError('NoEmailClaim', 'JWT email claim must be a non-empty string');
    }
    if (!isNonEmptyString(payload.sub)) {
      throw new AccessError('NoSubjectClaim', 'JWT sub claim must be a non-empty string');
    }
    if (payload.groups !== undefined && !isStringArray(payload.groups)) {
      throw new AccessError('InvalidGroupsClaim', 'JWT groups claim must be an array of strings');
    }
    return {
      email: payload.email.trim().toLowerCase(),
      sub: payload.sub.trim(),
      name: verifiedName(payload),
      groups: payload.groups,
      avatarUrl: isGoogleProfileImage(payload.picture) ? payload.picture : undefined,
    };
  } catch (cause) {
    if (cause instanceof AccessError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new AccessError('InvalidAccessJwt', `JWT verification failed: ${message}`);
  }
}

export function accessMiddleware(
  resolveApplication: (env: AuthEnv) => Promise<AccessApplication | null> = async (env) => configuredAccessApplication(env),
): MiddlewareHandler<{
  Bindings: AuthEnv;
  Variables: { identity: AccessIdentity };
}> {
  return async (c, next) => {
    if (c.get('identity')) {
      await next();
      return;
    }
    try {
      const identity = await verifyAccessRequest(c.req.raw, c.env, await resolveApplication(c.env));
      c.set('identity', identity);
      await next();
    } catch (err) {
      if (err instanceof AccessError) {
        return c.json({ ok: false, error: { tag: err.tag, message: err.message } }, 401);
      }
      throw err;
    }
  };
}
