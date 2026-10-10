import { describe, expect, test } from 'bun:test';
import { engineSource, safeSourcePath } from './engine-source';

const commit = 'c55684c4b0989fcf0ad69bad3250135d4ba59b36';

describe('engine source', () => {
  test('needs an exact commit and a GitHub repo', () => {
    expect(engineSource({ BUILD_ID: commit, ENGINE_REPO: 'https://github.com/acoyfellow/chat-ax.git' })).toEqual({ owner: 'acoyfellow', repo: 'chat-ax', commit });
    expect(engineSource({ BUILD_ID: 'main', ENGINE_REPO: 'acoyfellow/chat-ax' })).toBeNull();
    expect(engineSource({ BUILD_ID: commit })).toBeNull();
  });

  test('refuses paths that climb out of the repo', () => {
    expect(safeSourcePath('src/agent-do.ts')).toBe('src/agent-do.ts');
    expect(safeSourcePath('/README.md')).toBe('README.md');
    expect(safeSourcePath('../secrets')).toBeNull();
    expect(safeSourcePath('src/../../x')).toBeNull();
    expect(safeSourcePath('src/a b.ts')).toBeNull();
  });
});
