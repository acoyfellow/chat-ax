import { type CapabilityDecision, authorizeCapability } from './capability-policy';
import { createRoomSkill, deleteRoomSkill, editRoomSkill, type RoomSkill } from './room-skills';

export type CapabilityReceipt = {
  id: string;
  actorId: string;
  roomId: string;
  capability: string;
  decision: 'allowed' | 'denied';
  denialReason?: string;
  grantIds: string[];
  runtime: 'durable-object';
  resultVisibility: 'room';
  startedAt: string;
  finishedAt: string;
  status: 'succeeded' | 'denied' | 'failed';
};

export type CapabilityExecution = {
  result?: unknown;
  receipt: CapabilityReceipt;
};

export async function executeRoomPreview(input: {
  storage: DurableObjectStorage;
  actorId: string;
  roomId: string;
  text: string;
}): Promise<CapabilityExecution> {
  const capability = 'room.preview.write';
  const startedAt = new Date().toISOString();
  const decision = authorizeCapability({
    actorId: input.actorId,
    roomId: input.roomId,
    capability,
    declaredCapabilities: [capability],
    roomCapabilities: [capability],
    turnCapabilities: [capability],
    grants: [{
      id: 'room-preview-write',
      scope: 'room',
      ownerId: 'room-agent',
      roomId: input.roomId,
      capabilities: [capability],
      uses: 0,
    }],
    now: Date.now(),
  });
  if (!decision.allowed) {
    return { receipt: receiptFor(input, capability, decision, startedAt, 'denied') };
  }
  await input.storage.put('pi-playground:workspace:worker.js', input.text);
  return {
    result: { text: input.text },
    receipt: receiptFor(input, capability, decision, startedAt, 'succeeded'),
  };
}

export async function executeRoomSkillWrite(input: {
  storage: DurableObjectStorage;
  actorId: string;
  roomId: string;
  mode: 'create' | 'edit' | 'delete';
  name: string;
  description?: string;
  body?: string;
}): Promise<CapabilityExecution> {
  const capability =
    input.mode === 'create' ? 'room.skill.create' : input.mode === 'delete' ? 'room.skill.delete' : 'room.skill.edit';
  const startedAt = new Date().toISOString();
  const decision = authorizeCapability({
    actorId: input.actorId,
    roomId: input.roomId,
    capability,
    declaredCapabilities: [capability],
    roomCapabilities: [capability],
    turnCapabilities: [capability],
    grants: [{
      id: input.mode === 'create' ? 'room-skill-create' : input.mode === 'delete' ? 'room-skill-delete' : 'room-skill-edit',
      scope: 'room',
      ownerId: 'room-agent',
      roomId: input.roomId,
      capabilities: [capability],
      uses: 0,
    }],
    now: Date.now(),
  });
  if (!decision.allowed) {
    return { receipt: receiptFor(input, capability, decision, startedAt, 'denied') };
  }
  const skills = (await input.storage.get<RoomSkill[]>('room-skills')) ?? [];
  const result = input.mode === 'create'
    ? createRoomSkill(skills, {
        name: input.name,
        description: input.description ?? '',
        body: input.body ?? '',
        actorId: input.actorId,
      })
    : input.mode === 'delete'
      ? deleteRoomSkill(skills, input.name)
      : editRoomSkill(skills, {
          name: input.name,
          description: input.description,
          body: input.body,
          actorId: input.actorId,
        });
  if ('error' in result) {
    return {
      receipt: {
        ...receiptFor(input, capability, decision, startedAt, 'failed'),
        denialReason: result.error,
      },
    };
  }
  await input.storage.put('room-skills', result.skills);
  return {
    result: result.skill,
    receipt: receiptFor(input, capability, decision, startedAt, 'succeeded'),
  };
}

export function crossUserProbe(input: {
  actorId: string;
  grantOwnerId: string;
  roomId: string;
}): CapabilityDecision {
  return authorizeCapability({
    actorId: input.actorId,
    roomId: input.roomId,
    capability: 'personal.notes.read',
    declaredCapabilities: ['personal.notes.read'],
    roomCapabilities: ['personal.notes.read'],
    turnCapabilities: ['personal.notes.read'],
    grants: [
      {
        id: 'private-notes',
        scope: 'personal',
        ownerId: input.grantOwnerId,
        capabilities: ['personal.notes.read'],
        uses: 0,
      },
    ],
    now: Date.now(),
  });
}

function receiptFor(
  input: { actorId: string; roomId: string },
  capability: string,
  decision: CapabilityDecision,
  startedAt: string,
  status: CapabilityReceipt['status'],
): CapabilityReceipt {
  return {
    id: crypto.randomUUID(),
    actorId: input.actorId,
    roomId: input.roomId,
    capability,
    decision: decision.allowed ? 'allowed' : 'denied',
    denialReason: decision.allowed ? undefined : decision.reason,
    grantIds: decision.allowed ? decision.grantIds : [],
    runtime: 'durable-object',
    resultVisibility: 'room',
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
  };
}
