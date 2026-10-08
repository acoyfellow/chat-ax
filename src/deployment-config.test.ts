import { describe, expect, test } from 'bun:test';
import { accessIssuer, accessOAuthMetadata, adminEmails, aiGatewayId, canReadDiagnostics, isAdmin, workersAIGatewayId } from './deployment-config';

describe('deployment configuration', () => {
  test('admins come only from ADMIN_EMAILS, case-insensitively', () => {
    const env = { ADMIN_EMAILS: ' Owner@Example.com, second@example.com ,not-an-email' };
    expect([...adminEmails(env)]).toEqual(['owner@example.com', 'second@example.com']);
    expect(isAdmin(env, 'OWNER@example.com')).toBe(true);
    expect(isAdmin(env, 'someone@example.com')).toBe(false);
    expect(isAdmin({}, 'owner@example.com')).toBe(false);
  });

  test('diagnostics are open in local development and admin-only elsewhere', () => {
    expect(canReadDiagnostics({ ENVIRONMENT: 'dev' }, 'anyone@example.com')).toBe(true);
    expect(canReadDiagnostics({ ADMIN_EMAILS: 'owner@example.com' }, 'anyone@example.com')).toBe(false);
    expect(canReadDiagnostics({ ADMIN_EMAILS: 'owner@example.com' }, 'owner@example.com')).toBe(true);
  });

  test('the AI Gateway defaults to the account default gateway, which Cloudflare creates on first use', () => {
    expect(aiGatewayId({})).toBe('default');
    expect(aiGatewayId({ AI_GATEWAY_ID: '  team-gateway ' })).toBe('team-gateway');
  });

  test('Workers AI models skip AI Gateway unless a gateway is configured, so free accounts need no credits', () => {
    expect(workersAIGatewayId({})).toBeUndefined();
    expect(workersAIGatewayId({ AI_GATEWAY_ID: ' ' })).toBeUndefined();
    expect(workersAIGatewayId({ AI_GATEWAY_ID: 'ax' })).toBe('ax');
  });

  test('OAuth metadata follows the configured Access team, never a hardcoded one', () => {
    expect(accessIssuer({ CF_ACCESS_ISS: 'https://acme.cloudflareaccess.com/' })).toBe('https://acme.cloudflareaccess.com');
    expect(accessIssuer({ CF_ACCESS_ISS: 'http://acme.cloudflareaccess.com' })).toBeNull();
    expect(accessIssuer({})).toBeNull();
    expect(accessOAuthMetadata('https://acme.cloudflareaccess.com').token_endpoint).toBe('https://acme.cloudflareaccess.com/cdn-cgi/access/oauth/token');
  });
});
