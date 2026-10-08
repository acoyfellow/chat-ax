import { describe, expect, test } from 'bun:test';
import { isLocalDevBypassAllowed, verifyAccessRequest } from './auth';

describe('access boundary', () => {
  test('allows an explicit local development identity on loopback', () => {
    expect(
      isLocalDevBypassAllowed(new Request('http://127.0.0.1:8787/'), {
        ENVIRONMENT: 'dev',
        DEV_USER_EMAIL: 'developer@example.com',
      }),
    ).toBe(true);
  });

  test('uses the configured verified display name in development', async () => {
    const identity = await verifyAccessRequest(new Request('http://127.0.0.1:8787/'), {
      ENVIRONMENT: 'dev',
      DEV_USER_EMAIL: 'developer@example.com',
      DEV_USER_NAME: 'Jordan Coeyman',
    });
    expect(identity.name).toBe('Jordan Coeyman');
  });

  test('never allows the development identity on a deployed host', () => {
    expect(
      isLocalDevBypassAllowed(new Request('https://chat.example.com/'), {
        ENVIRONMENT: 'dev',
        DEV_USER_EMAIL: 'developer@example.com',
      }),
    ).toBe(false);
  });

  test('fails closed without an explicit development environment', () => {
    expect(
      isLocalDevBypassAllowed(new Request('http://127.0.0.1:8787/'), {
        DEV_USER_EMAIL: 'developer@example.com',
      }),
    ).toBe(false);
  });
});
