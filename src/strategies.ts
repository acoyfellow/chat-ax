export type StrategyId =
  | 'fifo'
  | 'lifo'
  | 'shortest'
  | 'longest'
  | 'host-first'
  | 'round-robin'
  | 'least-recent'
  | 'participant-blocks'
  | 'parallel-pair'
  | 'parallel-trio'
  | 'parallel-burst'
  | 'wave-two'
  | 'wave-four'
  | 'fair-wave'
  | 'quick-pair'
  | 'host-plus-one'
  | 'adaptive'
  | 'shuffle'
  | 'newest-per-person'
  | 'calm-drain';

export type StrategyCategory = 'Order' | 'Fairness' | 'Parallelism' | 'Batching' | 'Adaptive';

type StrategyOrder =
  | 'fifo'
  | 'lifo'
  | 'shortest'
  | 'longest'
  | 'host-first'
  | 'round-robin'
  | 'least-recent'
  | 'participant-blocks'
  | 'shuffle'
  | 'newest-per-person';

export type Strategy = {
  id: StrategyId;
  category: StrategyCategory;
  label: string;
  summary: string;
  concurrency: number | 'unbounded';
  batchSize?: number;
  order: StrategyOrder;
};

export type PlannableTurn = {
  id: string;
  authorId: string;
  prompt: string;
};

export const strategies: Strategy[] = [
  {
    id: 'fifo',
    category: 'Order',
    label: 'First in, first out',
    summary: 'Arrival order, one at a time',
    concurrency: 1,
    order: 'fifo',
  },
  {
    id: 'lifo',
    category: 'Order',
    label: 'Newest first',
    summary: 'The latest request goes next',
    concurrency: 1,
    order: 'lifo',
  },
  {
    id: 'shortest',
    category: 'Order',
    label: 'Quick wins',
    summary: 'Short prompts go first',
    concurrency: 1,
    order: 'shortest',
  },
  {
    id: 'longest',
    category: 'Order',
    label: 'Deep work first',
    summary: 'Long prompts go first',
    concurrency: 1,
    order: 'longest',
  },
  {
    id: 'host-first',
    category: 'Order',
    label: 'Room starter priority',
    summary: 'The first participant goes first',
    concurrency: 1,
    order: 'host-first',
  },
  {
    id: 'round-robin',
    category: 'Fairness',
    label: 'Round robin',
    summary: 'Rotate between participants',
    concurrency: 1,
    order: 'round-robin',
  },
  {
    id: 'least-recent',
    category: 'Fairness',
    label: 'Least recently served',
    summary: 'Prioritize whoever waited longest',
    concurrency: 1,
    order: 'least-recent',
  },
  {
    id: 'participant-blocks',
    category: 'Fairness',
    label: 'Participant blocks',
    summary: 'Keep one person’s adjacent requests together',
    concurrency: 1,
    order: 'participant-blocks',
  },
  {
    id: 'parallel-pair',
    category: 'Parallelism',
    label: 'Parallel pair',
    summary: 'Run two requests at once',
    concurrency: 2,
    order: 'fifo',
  },
  {
    id: 'parallel-trio',
    category: 'Parallelism',
    label: 'Parallel trio',
    summary: 'Run three requests at once',
    concurrency: 3,
    order: 'fifo',
  },
  {
    id: 'parallel-burst',
    category: 'Parallelism',
    label: 'Parallel burst',
    summary: 'Start every waiting request',
    concurrency: 'unbounded',
    order: 'fifo',
  },
  {
    id: 'wave-two',
    category: 'Batching',
    label: 'Pairs in waves',
    summary: 'Finish each pair before the next',
    concurrency: 2,
    batchSize: 2,
    order: 'fifo',
  },
  {
    id: 'wave-four',
    category: 'Batching',
    label: 'Room waves',
    summary: 'Finish each group of four together',
    concurrency: 4,
    batchSize: 4,
    order: 'fifo',
  },
  {
    id: 'fair-wave',
    category: 'Batching',
    label: 'One per person',
    summary: 'Take at most one request per person',
    concurrency: 4,
    batchSize: 4,
    order: 'round-robin',
  },
  {
    id: 'quick-pair',
    category: 'Batching',
    label: 'Quick-win pair',
    summary: 'Run the two shortest prompts',
    concurrency: 2,
    batchSize: 2,
    order: 'shortest',
  },
  {
    id: 'host-plus-one',
    category: 'Batching',
    label: 'Starter plus one',
    summary: 'Pair the first participant with the room',
    concurrency: 2,
    batchSize: 2,
    order: 'host-first',
  },
  {
    id: 'adaptive',
    category: 'Adaptive',
    label: 'Adaptive pressure',
    summary: 'Open three lanes when demand rises',
    concurrency: 3,
    order: 'fifo',
  },
  {
    id: 'shuffle',
    category: 'Adaptive',
    label: 'Visible lottery',
    summary: 'Use a deterministic shuffled order',
    concurrency: 1,
    order: 'shuffle',
  },
  {
    id: 'newest-per-person',
    category: 'Adaptive',
    label: 'Freshest per person',
    summary: 'Consider each person’s newest request first',
    concurrency: 2,
    order: 'newest-per-person',
  },
  {
    id: 'calm-drain',
    category: 'Adaptive',
    label: 'Calm drain',
    summary: 'Advance quietly, one at a time',
    concurrency: 1,
    order: 'fifo',
  },
];

export const strategyCategories: StrategyCategory[] = [
  'Order',
  'Fairness',
  'Parallelism',
  'Batching',
  'Adaptive',
];

export function isStrategyId(value: string): value is StrategyId {
  return strategies.some((strategy) => strategy.id === value);
}

export function strategyById(id: StrategyId): Strategy {
  return strategies.find((strategy) => strategy.id === id) ?? strategies[0];
}

export function planTurns<T extends PlannableTurn>(
  turns: T[],
  strategy: Strategy,
  servedAuthors: string[],
  hostAuthorId?: string,
): T[] {
  const ordered = orderTurns(turns, strategy.order, servedAuthors, hostAuthorId);
  const diverse = strategy.id === 'fair-wave' ? onePerAuthorFirst(ordered) : ordered;
  const capacity = strategy.id === 'adaptive' && turns.length < 3 ? 1 : strategy.concurrency;
  const count = strategy.batchSize ?? (capacity === 'unbounded' ? diverse.length : capacity);
  return diverse.slice(0, count);
}

function orderTurns<T extends PlannableTurn>(
  turns: T[],
  order: StrategyOrder,
  servedAuthors: string[],
  hostAuthorId?: string,
): T[] {
  const indexed = turns.map((turn, index) => ({ turn, index }));
  if (order === 'lifo') return [...turns].reverse();
  if (order === 'shortest') return stableSort(indexed, (entry) => entry.turn.prompt.length);
  if (order === 'longest') return stableSort(indexed, (entry) => -entry.turn.prompt.length);
  if (order === 'host-first')
    return stableSort(indexed, (entry) => (entry.turn.authorId === hostAuthorId ? 0 : 1));
  if (order === 'round-robin') return onePerAuthorFirst(turns);
  if (order === 'least-recent') {
    return stableSort(indexed, (entry) => {
      const servedIndex = servedAuthors.lastIndexOf(entry.turn.authorId);
      return servedIndex === -1 ? -1 : servedIndex;
    });
  }
  if (order === 'participant-blocks') {
    const authorOrder = [...new Set(turns.map((turn) => turn.authorId))];
    return authorOrder.flatMap((authorId) => turns.filter((turn) => turn.authorId === authorId));
  }
  if (order === 'shuffle') return stableSort(indexed, (entry) => hash(entry.turn.id));
  if (order === 'newest-per-person') {
    const latest = new Map<string, T>();
    for (const turn of turns) latest.set(turn.authorId, turn);
    const newest = [...latest.values()].reverse();
    const newestIds = new Set(newest.map((turn) => turn.id));
    return [...newest, ...turns.filter((turn) => !newestIds.has(turn.id))];
  }
  return turns;
}

function onePerAuthorFirst<T extends PlannableTurn>(turns: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const turn of turns) groups.set(turn.authorId, [...(groups.get(turn.authorId) ?? []), turn]);
  const ordered: T[] = [];
  while (ordered.length < turns.length) {
    for (const group of groups.values()) {
      const next = group.shift();
      if (next) ordered.push(next);
    }
  }
  return ordered;
}

function stableSort<T extends PlannableTurn>(
  indexed: Array<{ turn: T; index: number }>,
  score: (entry: { turn: T; index: number }) => number,
): T[] {
  return indexed
    .sort((left, right) => score(left) - score(right) || left.index - right.index)
    .map((entry) => entry.turn);
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
