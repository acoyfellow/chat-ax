import { describe, expect, test } from 'bun:test';
import { setupPage } from './setup-page';

describe('unconfigured Worker page', () => {
  test('points the deployer at npm run setup', () => {
    const html = setupPage('my-chat');
    expect(html).toContain('npm run setup');
    expect(html).toContain('CF_ACCESS_ISS');
    expect(html).not.toContain('<form');
  });

  test('escapes the Worker name', () => {
    const html = setupPage('<script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;');
  });
});
