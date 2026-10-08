import { describe, expect, test } from 'bun:test';
import { addSibling, addSubagent, childrenOf, createThreadTree, lens, pathTo } from './thread-tree';

const node = (id: string, title = id) => ({ id, title, status: 'idle' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

describe('thread tree', () => {
  test('starts with one root conversation', () => {
    const tree = createThreadTree('2026-01-01T00:00:00.000Z', 'root');
    expect(tree.rootId).toBe('root');
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]?.kind).toBe('conversation');
  });

  test('adds sibling conversations on the same layer', () => {
    const tree = addSibling(createThreadTree('now', 'root'), 'root', node('sibling'));
    expect(childrenOf(tree, 'root')).toHaveLength(0);
    expect(tree.nodes.find((item) => item.id === 'sibling')?.parentId).toBeNull();
    expect(tree.nodes.find((item) => item.id === 'sibling')?.kind).toBe('conversation');
  });

  test('adds subagents below a conversation', () => {
    const tree = addSubagent(createThreadTree('now', 'root'), 'root', node('child'));
    expect(childrenOf(tree, 'root').map((item) => item.id)).toEqual(['child']);
    expect(tree.nodes.find((item) => item.id === 'child')?.kind).toBe('subagent');
  });

  test('returns the parent path and current lens children', () => {
    let tree = createThreadTree('now', 'root');
    tree = addSubagent(tree, 'root', node('child'));
    tree = addSubagent(tree, 'child', node('grandchild'));
    expect(pathTo(tree, 'grandchild').map((item) => item.id)).toEqual(['root', 'child', 'grandchild']);
    expect(lens(tree, 'child').children.map((item) => item.id)).toEqual(['grandchild']);
  });
});
