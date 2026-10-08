import icon192 from './public/icon-192.png?url';
import icon512 from './public/icon-512.png?url';
import iconMaskable from './public/icon-maskable-512.png?url';
import appleTouch from './public/apple-touch-icon.png?url';
import favicon32 from './public/favicon-32.png?url';
import favicon16 from './public/favicon-16.png?url';

export const pwaAssets = {
  icon192,
  icon512,
  iconMaskable,
  appleTouch,
  favicon32,
  favicon16,
};

export function pwaManifest() {
  return {
    name: 'Chat AX',
    short_name: 'Chat AX',
    description: 'A shared Cloudflare room with one agent.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ea580c',
    icons: [
      { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: iconMaskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export function pwaHead(): string {
  return [
    '<meta name="theme-color" content="#ea580c">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<meta name="apple-mobile-web-app-title" content="Chat AX">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    `<link rel="icon" type="image/png" sizes="32x32" href="${favicon32}">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="${favicon16}">`,
    `<link rel="apple-touch-icon" href="${appleTouch}">`,
  ].join('');
}
