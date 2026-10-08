import { describe, expect, test } from 'bun:test';
import { parse } from '@babel/parser';

const externallyReachableRequestHandlers = [
  'src/agent-do.ts',
  'src/room.ts',
  'src/connector-vault.ts',
  'src/worker.ts',
] as const;

function directBodyReaders(source: string, path: string): string[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const findings: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = node.callee as Record<string, unknown> | undefined;
      if (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') {
        const property = callee.property as Record<string, unknown> | undefined;
        const method =
          property?.type === 'Identifier' || property?.type === 'StringLiteral'
            ? property.name ?? property.value
            : undefined;
        const object = callee.object as { start?: number; end?: number } | undefined;
        const receiver = source
          .slice(object?.start ?? 0, object?.end ?? 0)
          .replaceAll(/\s+/g, '')
          .replaceAll('?.', '.')
          .replaceAll('["req"]', '.req')
          .replaceAll("['req']", '.req');
        if (
          (method === 'json' || method === 'text') &&
          (receiver === 'request' ||
            receiver.startsWith('request.') ||
            receiver === 'context.req' ||
            receiver.startsWith('context.req.'))
        ) {
          const location = node.loc as { start?: { line?: number; column?: number } } | undefined;
          findings.push(`${path}:${location?.start?.line ?? 0}:${(location?.start?.column ?? 0) + 1}`);
        }
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(ast);
  return findings;
}

describe('bounded JSON handler audit', () => {
  for (const path of externallyReachableRequestHandlers) {
    test(`${path} does not bypass bounded request parsing`, async () => {
      expect(directBodyReaders(await Bun.file(path).text(), path)).toEqual([]);
    });
  }

  test('syntax-aware audit catches formatting and optional chaining', () => {
    expect(directBodyReaders('request /* comment */ . json()', 'fixture.ts')).toHaveLength(1);
    expect(directBodyReaders('context?.req?.raw.clone().text()', 'fixture.ts')).toHaveLength(1);
    expect(directBodyReaders("context['req'].json()", 'fixture.ts')).toHaveLength(1);
    expect(directBodyReaders('request["json"]()', 'fixture.ts')).toHaveLength(1);
    expect(directBodyReaders('request?.["text"]?.()', 'fixture.ts')).toHaveLength(1);
  });
});
