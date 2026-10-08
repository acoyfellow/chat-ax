import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { sendWebPush } from './web-push';

function base64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('base64url');
}

function keys() {
  const vapid = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const client = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const vapidPublic = vapid.publicKey.export({ format: 'jwk' });
  const vapidPrivate = vapid.privateKey.export({ format: 'jwk' });
  const clientPublic = client.publicKey.export({ format: 'jwk' });
  if (!vapidPublic.x || !vapidPublic.y || !vapidPrivate.d || !clientPublic.x || !clientPublic.y)
    throw new Error('generated EC key is incomplete');
  return {
    credentials: {
      subject: 'mailto:test@example.com',
      publicKey: Buffer.concat([
        Buffer.from([4]),
        Buffer.from(vapidPublic.x, 'base64url'),
        Buffer.from(vapidPublic.y, 'base64url'),
      ]).toString('base64url'),
      privateKey: base64Url(vapidPrivate.d),
    },
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription',
      keys: {
        auth: randomBytes(16).toString('base64url'),
        p256dh: Buffer.concat([
          Buffer.from([4]),
          Buffer.from(clientPublic.x, 'base64url'),
          Buffer.from(clientPublic.y, 'base64url'),
        ]).toString('base64url'),
      },
    },
  };
}

describe('web push', () => {
  test('builds an encrypted VAPID request that targets authoritative room state', async () => {
    const input = keys();
    let request: Request | undefined;
    const delivered = await sendWebPush(
      input.credentials,
      input.subscription,
      {
        title: 'Agent replied',
        body: 'Done',
        href: '/?message=reply-1',
        notificationId: 'notification-1',
      },
      async (url, init) => {
        request = new Request(url, init);
        return new Response('', { status: 201 });
      },
    );
    expect(delivered).toBe(true);
    expect(request?.url).toBe(input.subscription.endpoint);
    expect(request?.headers.get('authorization')).toStartWith('vapid t=');
    expect(request?.headers.get('content-encoding')).toBe('aes128gcm');
    expect((await request?.arrayBuffer())?.byteLength).toBeGreaterThan(100);
  });

  test('rejects authenticated requests to non-provider endpoints', async () => {
    const input = keys();
    let requests = 0;
    const delivered = await sendWebPush(
      input.credentials,
      { ...input.subscription, endpoint: 'https://internal.example.test/push' },
      { title: 'Agent replied', body: 'Done', href: '/', notificationId: 'notification-1' },
      async () => {
        requests += 1;
        return new Response('', { status: 201 });
      },
    );
    expect(delivered).toBe(false);
    expect(requests).toBe(0);
  });

  test('fails closed when VAPID credentials are absent', async () => {
    const input = keys();
    expect(
      await sendWebPush({}, input.subscription, {
        title: 'Agent replied',
        body: 'Done',
        href: '/',
        notificationId: 'notification-1',
      }),
    ).toBe(false);
  });
});
