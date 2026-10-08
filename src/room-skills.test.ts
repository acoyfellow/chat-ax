import { describe, expect, test } from 'bun:test';
import { createRoomSkill, deleteRoomSkill, editRoomSkill, normalizeSkillName } from './room-skills';

describe('room skills', () => {
  test('creates a reusable kebab-case skill', () => {
    const created = createRoomSkill([], {
      name: 'Review-MR',
      description: 'Review a pull request.',
      body: 'Read the diff. Leave one verdict.',
      actorId: 'room-agent',
      now: '2026-09-05T00:00:00.000Z',
    });
    expect('skill' in created && created.skill.name).toBe('review-mr');
  });

  test('rejects duplicate creates and missing edits', () => {
    const created = createRoomSkill([], {
      name: 'review-mr',
      description: 'Review a pull request.',
      body: 'Read the diff.',
      actorId: 'a',
    });
    if (!('skills' in created)) throw new Error('expected create');
    expect(createRoomSkill(created.skills, {
      name: 'review-mr',
      description: 'Review a pull request.',
      body: 'Read the diff.',
      actorId: 'a',
    })).toEqual({ error: 'skill already exists' });
    expect(editRoomSkill([], { name: 'review-mr', body: 'New body', actorId: 'a' })).toEqual({
      error: 'skill not found',
    });
  });

  test('edits an existing skill body', () => {
    const created = createRoomSkill([], {
      name: 'review-mr',
      description: 'Review a pull request.',
      body: 'Read the diff.',
      actorId: 'a',
      now: '2026-09-05T00:00:00.000Z',
    });
    if (!('skills' in created)) throw new Error('expected create');
    const edited = editRoomSkill(created.skills, {
      name: 'review-mr',
      body: 'Read the diff. Cite files.',
      actorId: 'b',
      now: '2026-09-05T01:00:00.000Z',
    });
    expect('skill' in edited && edited.skill.body).toBe('Read the diff. Cite files.');
    expect('skill' in edited && edited.skill.updatedBy).toBe('b');
  });

  test('deletes an existing skill', () => {
    const created = createRoomSkill([], {
      name: 'review-mr',
      description: 'Review a pull request.',
      body: 'Read the diff.',
      actorId: 'a',
    });
    if (!('skills' in created)) throw new Error('expected create');
    const deleted = deleteRoomSkill(created.skills, 'review-mr');
    expect('skills' in deleted && deleted.skills).toEqual([]);
  });

  test('rejects invalid names', () => {
    expect(normalizeSkillName('../etc')).toBeNull();
    expect(normalizeSkillName('A')).toBeNull();
  });
});
