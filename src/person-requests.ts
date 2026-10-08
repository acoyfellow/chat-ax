import * as v from 'valibot';

export type PersonRequestStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export type PersonRequestActor = {
  id: string;
  email: string;
  name: string;
};

export type PersonRequest = {
  id: string;
  requesterId: string;
  requesterEmail: string;
  requesterName: string;
  recipientEmail: string;
  recipientId?: string;
  recipientName?: string;
  title: string;
  details: string;
  kind?: 'review';
  resourceUrl?: string;
  initiatingMessageId?: string;
  agentId?: string;
  runMessageId?: string;
  provenance?: {
    skill: string;
    recipe: string;
    recipeVersion: number;
    recipeDigest: string;
  };
  status: PersonRequestStatus;
  response?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const emailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email(), v.maxLength(320));
const titleSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(240));
const detailsSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(8_000));
const responseSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4_000));

export type CreatePersonRequestInput = {
  recipientEmail: string;
  recipientName?: string;
  title: string;
  details: string;
  kind?: 'review';
  resourceUrl?: string;
  initiatingMessageId?: string;
  agentId?: string;
};

export type PersonRequestAction = 'accept' | 'decline' | 'complete' | 'cancel' | 'respond';

export function parseCreatePersonRequestInput(
  value: CreatePersonRequestInput,
): CreatePersonRequestInput {
  return v.parse(
    v.object({
      recipientEmail: emailSchema,
      recipientName: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))),
      title: titleSchema,
      details: detailsSchema,
      kind: v.optional(v.literal('review')),
      resourceUrl: v.optional(v.pipe(v.string(), v.url(), v.maxLength(2_000))),
      initiatingMessageId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
      agentId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
    }),
    value,
  );
}

export function parsePersonRequestResponse(value: unknown): string {
  return v.parse(responseSchema, value);
}

export function createPersonRequest(
  actor: PersonRequestActor,
  input: CreatePersonRequestInput,
  now = new Date(),
  id = crypto.randomUUID(),
): PersonRequest {
  const createdAt = now.toISOString();
  return {
    id,
    requesterId: actor.id,
    requesterEmail: v.parse(emailSchema, actor.email),
    requesterName: v.parse(
      v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
      actor.name,
    ),
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    title: input.title,
    details: input.details,
    kind: input.kind,
    resourceUrl: input.resourceUrl,
    initiatingMessageId: input.initiatingMessageId,
    agentId: input.agentId,
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
  };
}

export function isRequester(request: PersonRequest, actor: PersonRequestActor): boolean {
  return request.requesterId === actor.id;
}

export function isRecipient(request: PersonRequest, actor: PersonRequestActor): boolean {
  return request.recipientEmail === actor.email.toLowerCase();
}

export function canViewPersonRequest(request: PersonRequest, actor: PersonRequestActor): boolean {
  return isRequester(request, actor) || isRecipient(request, actor);
}

export function bindPersonRequestRecipient(
  request: PersonRequest,
  actor: PersonRequestActor,
): PersonRequest {
  if (!isRecipient(request, actor))
    throw new Error('Only the intended recipient can claim this request');
  if (request.recipientId && request.recipientId !== actor.id)
    throw new Error('This request is already bound to another identity');
  return { ...request, recipientId: actor.id, recipientName: actor.name };
}

export function applyPersonRequestAction(
  request: PersonRequest,
  actor: PersonRequestActor,
  action: PersonRequestAction,
  response: string | undefined,
  now = new Date(),
): PersonRequest {
  if (!canViewPersonRequest(request, actor)) throw new Error('Request not found');
  const at = now.toISOString();
  if (action === 'cancel') {
    if (!isRequester(request, actor)) throw new Error('Only the requester can cancel this request');
    if (request.status !== 'pending' && request.status !== 'accepted')
      throw new Error('This request can no longer be cancelled');
    return { ...request, status: 'cancelled', updatedAt: at, completedAt: at };
  }
  if (!isRecipient(request, actor)) throw new Error('Only the recipient can perform this action');
  const bound = bindPersonRequestRecipient(request, actor);
  if (action === 'accept') {
    if (request.status !== 'pending') throw new Error('Only pending requests can be accepted');
    return { ...bound, status: 'accepted', updatedAt: at };
  }
  if (action === 'decline') {
    if (request.status !== 'pending') throw new Error('Only pending requests can be declined');
    return {
      ...bound,
      status: 'declined',
      response: response ? parsePersonRequestResponse(response) : undefined,
      updatedAt: at,
      completedAt: at,
    };
  }
  if (action === 'complete') {
    if (request.status !== 'accepted') throw new Error('Only accepted requests can be completed');
    return {
      ...bound,
      status: 'completed',
      response: response ? parsePersonRequestResponse(response) : request.response,
      updatedAt: at,
      completedAt: at,
    };
  }
  if (request.status !== 'pending' && request.status !== 'accepted')
    throw new Error('This request can no longer receive a response');
  return {
    ...bound,
    response: parsePersonRequestResponse(response),
    updatedAt: at,
  };
}

export function appendPersonRequest(
  requests: PersonRequest[],
  request: PersonRequest,
  maximum = 500,
): PersonRequest[] {
  if (requests.length < maximum) return [...requests, request];
  const removable = requests.findIndex(
    (item) =>
      item.status === 'declined' ||
      item.status === 'completed' ||
      item.status === 'blocked' ||
      item.status === 'cancelled',
  );
  if (removable < 0) throw new Error('The room has too many active requests');
  return [...requests.slice(0, removable), ...requests.slice(removable + 1), request];
}

export function personRequestTaskStatus(
  request: PersonRequest,
  actor: PersonRequestActor,
): 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled' {
  if (!canViewPersonRequest(request, actor)) throw new Error('Request not found');
  if (request.status === 'cancelled') return 'cancelled';
  if (request.status === 'declined' || request.status === 'blocked') return 'failed';
  if (request.status === 'completed') return 'completed';
  if (request.status === 'pending' && isRecipient(request, actor)) return 'input_required';
  return 'working';
}
