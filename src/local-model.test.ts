import { describe, expect, test } from 'bun:test';
import { localModelReply } from './local-model';

describe('local test model', () => {
  test('echoes the prompt and explains how to reach real models', () => {
    const reply = localModelReply('  What did   we decide? ');
    expect(reply).toStartWith('You said: "What did we decide?"');
    expect(reply).toContain('local test model');
  });

  test('keeps long prompts short', () => {
    expect(localModelReply('x'.repeat(500)).split('\n')[0].length).toBeLessThan(140);
  });
});
