import { describe, expect, test } from 'bun:test';
import { strategies } from './strategies';
import { createUiStressFixture } from './ui-stress';

describe('UI stress fixture', () => {
  test('creates five people, one agent, five hundred messages, and every strategy', () => {
    const strategyIds = strategies.map((strategy) => strategy.id);
    const fixture = createUiStressFixture(strategyIds, 500, Date.parse('2026-09-02T16:00:00Z'));
    const people = new Set(
      fixture.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.authorId),
    );
    const representedStrategies = new Set(fixture.messages.map((message) => message.strategyId));

    expect(fixture.messages).toHaveLength(500);
    expect(people.size).toBe(5);
    expect(fixture.messages.filter((message) => message.role === 'assistant')).toHaveLength(250);
    expect(representedStrategies.size).toBe(strategyIds.length);
    expect(fixture.online).toHaveLength(5);
  });
});
