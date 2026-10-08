export type ThreadKind = 'conversation' | 'subagent';
export type ThreadStatus = 'active' | 'idle' | 'complete' | 'failed';

export type ThreadNode = {
  id: string;
  parentId: string | null;
  kind: ThreadKind;
  title: string;
  avatarSeed: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
};

export type ThreadTree = {
  rootId: string;
  nodes: ThreadNode[];
};

export function createThreadTree(now = new Date().toISOString(), id = crypto.randomUUID()): ThreadTree {
  return {
    rootId: id,
    nodes: [{ id, parentId: null, kind: 'conversation', title: 'Agent A', avatarSeed: id, status: 'idle', createdAt: now, updatedAt: now }],
  };
}

export function childrenOf(tree: ThreadTree, parentId: string): ThreadNode[] {
  return tree.nodes.filter((node) => node.parentId === parentId);
}

export function pathTo(tree: ThreadTree, nodeId: string): ThreadNode[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const path: ThreadNode[] = [];
  let current = byId.get(nodeId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function addSibling(tree: ThreadTree, siblingOf: string, node: Omit<ThreadNode, 'parentId' | 'kind'> & { kind?: 'conversation' }): ThreadTree {
  const parent = tree.nodes.find((candidate) => candidate.id === siblingOf)?.parentId ?? null;
  const created = { ...node, kind: 'conversation' as const, parentId: parent };
  const insertAt = tree.nodes.findIndex((candidate) => candidate.parentId === parent);
  const nodes = insertAt < 0 ? [...tree.nodes, created] : [...tree.nodes.slice(0, insertAt), created, ...tree.nodes.slice(insertAt)];
  return { ...tree, nodes };
}

export function addSubagent(tree: ThreadTree, parentId: string, node: Omit<ThreadNode, 'parentId' | 'kind'>): ThreadTree {
  if (!tree.nodes.some((candidate) => candidate.id === parentId)) throw new Error('Unknown thread parent');
  const created = { ...node, kind: 'subagent' as const, parentId };
  const insertAt = tree.nodes.findIndex((candidate) => candidate.parentId === parentId);
  const nodes = insertAt < 0 ? [...tree.nodes, created] : [...tree.nodes.slice(0, insertAt), created, ...tree.nodes.slice(insertAt)];
  return { ...tree, nodes };
}

export function lens(tree: ThreadTree, nodeId: string): { current: ThreadNode; path: ThreadNode[]; children: ThreadNode[] } {
  const current = tree.nodes.find((node) => node.id === nodeId);
  if (!current) throw new Error('Unknown thread');
  return { current, path: pathTo(tree, nodeId), children: childrenOf(tree, nodeId) };
}
