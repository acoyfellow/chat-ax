export type RoomSkill = {
  name: string;
  description: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};

export const maximumSkillBodyLength = 32_000;
export const maximumSkillDescriptionLength = 500;

export function normalizeSkillName(value: string): string | null {
  const name = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) return null;
  return name;
}

export function normalizeSkillDescription(value: string): string | null {
  const description = value.trim().replace(/\s+/g, ' ');
  if (!description || description.length > maximumSkillDescriptionLength) return null;
  return description;
}

export function normalizeSkillBody(value: string): string | null {
  const body = value.trim();
  if (!body || body.length > maximumSkillBodyLength) return null;
  return body;
}

export function createRoomSkill(
  skills: readonly RoomSkill[],
  input: { name: string; description: string; body: string; actorId: string; now?: string },
): { skills: RoomSkill[]; skill: RoomSkill } | { error: string } {
  const name = normalizeSkillName(input.name);
  const description = normalizeSkillDescription(input.description);
  const body = normalizeSkillBody(input.body);
  if (!name) return { error: 'invalid skill name' };
  if (!description) return { error: 'invalid skill description' };
  if (!body) return { error: 'invalid skill body' };
  if (skills.some((skill) => skill.name === name)) return { error: 'skill already exists' };
  const timestamp = input.now ?? new Date().toISOString();
  const skill: RoomSkill = {
    name,
    description,
    body,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: input.actorId,
    updatedBy: input.actorId,
  };
  return { skills: [...skills, skill], skill };
}

export function editRoomSkill(
  skills: readonly RoomSkill[],
  input: { name: string; description?: string; body?: string; actorId: string; now?: string },
): { skills: RoomSkill[]; skill: RoomSkill } | { error: string } {
  const name = normalizeSkillName(input.name);
  if (!name) return { error: 'invalid skill name' };
  const current = skills.find((skill) => skill.name === name);
  if (!current) return { error: 'skill not found' };
  const description =
    input.description === undefined ? current.description : normalizeSkillDescription(input.description);
  const body = input.body === undefined ? current.body : normalizeSkillBody(input.body);
  if (!description) return { error: 'invalid skill description' };
  if (!body) return { error: 'invalid skill body' };
  if (input.description === undefined && input.body === undefined) return { error: 'no skill changes' };
  const skill: RoomSkill = {
    ...current,
    description,
    body,
    updatedAt: input.now ?? new Date().toISOString(),
    updatedBy: input.actorId,
  };
  return {
    skills: skills.map((candidate) => (candidate.name === name ? skill : candidate)),
    skill,
  };
}

export function deleteRoomSkill(
  skills: readonly RoomSkill[],
  name: string,
): { skills: RoomSkill[]; skill: RoomSkill } | { error: string } {
  const normalized = normalizeSkillName(name);
  if (!normalized) return { error: 'invalid skill name' };
  const skill = skills.find((candidate) => candidate.name === normalized);
  if (!skill) return { error: 'skill not found' };
  return { skills: skills.filter((candidate) => candidate.name !== normalized), skill };
}
