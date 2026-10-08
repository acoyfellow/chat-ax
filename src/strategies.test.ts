import { describe, expect, test } from 'bun:test';
import { planTurns, strategies, strategyById } from './strategies';

const turns = [
  { id: '1', authorId: 'a', prompt: 'medium prompt' },
  { id: '2', authorId: 'b', prompt: 'x' },
  { id: '3', authorId: 'a', prompt: 'this is the longest prompt' },
  { id: '4', authorId: 'c', prompt: 'short' },
];

describe('routing strategies', () => {
  test('exposes twenty unique strategies', () => {
    expect(strategies).toHaveLength(20);
    expect(new Set(strategies.map((strategy) => strategy.id)).size).toBe(20);
  });

  test('applies order and concurrency when admitting turns', () => {
    expect(planTurns(turns, strategyById('fifo'), [], 'a').map((turn) => turn.id)).toEqual(['1']);
    expect(planTurns(turns, strategyById('lifo'), [], 'a').map((turn) => turn.id)).toEqual(['4']);
    expect(planTurns(turns, strategyById('quick-pair'), [], 'a').map((turn) => turn.id)).toEqual([
      '2',
      '4',
    ]);
    expect(
      planTurns(turns, strategyById('parallel-burst'), [], 'a').map((turn) => turn.id),
    ).toEqual(['1', '2', '3', '4']);
  });

  test('keeps fair waves diverse before repeating a participant', () => {
    expect(
      planTurns(turns, strategyById('fair-wave'), [], 'a').map((turn) => turn.authorId),
    ).toEqual(['a', 'b', 'c', 'a']);
  });
});
