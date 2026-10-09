import { toolArgumentsDetail } from './tool-activity-detail';

export const agentTraceName = 'chat-ax-agent';

export type TraceAttributes = Record<string, boolean | number | string | undefined>;

export type TraceSpan = {
  setAttributes(attributes: TraceAttributes): unknown;
  recordException?(exception: { name: string; message?: string }): unknown;
};

export type TraceTracer = {
  enterSpan<T>(name: string, callback: (span: TraceSpan) => T): T;
};

export type AgentTraceIdentity = { agentId: string; conversationId: string };

const maximumPayloadCharacters = 2_000;

export function boundedPayload(value: string): string {
  return value.length > maximumPayloadCharacters ? `${value.slice(0, maximumPayloadCharacters)}… truncated` : value;
}

export function identityAttributes(operation: string, identity: AgentTraceIdentity): TraceAttributes {
  return {
    'gen_ai.operation.name': operation,
    'gen_ai.agent.name': agentTraceName,
    'gen_ai.agent.id': identity.agentId,
    'gen_ai.conversation.id': identity.conversationId,
  };
}

export function toolAttributes(toolName: string, toolCallId: string, argumentsValue: unknown): TraceAttributes {
  return {
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': toolName,
    'gen_ai.tool.call.id': toolCallId,
    'gen_ai.tool.call.arguments': boundedPayload(toolArgumentsDetail(argumentsValue) ?? '{}'),
  };
}

export type ApprovalTraceStage = 'requested' | 'approved' | 'denied' | 'ran' | 'failed';

export function approvalAttributes(input: {
  approvalId: string;
  toolName: string;
  stage: ApprovalTraceStage;
  requesterEmail: string;
  connectorOwnerEmail: string;
  argumentsJson: string;
  argumentsDigest: string;
}): TraceAttributes {
  return {
    'gen_ai.operation.name': 'tool_approval',
    'gen_ai.tool.name': input.toolName,
    'chat_ax.approval.id': input.approvalId,
    'chat_ax.approval.stage': input.stage,
    'chat_ax.approval.requester': input.requesterEmail,
    'chat_ax.approval.connector_owner': input.connectorOwnerEmail,
    'chat_ax.approval.arguments_fingerprint': input.argumentsDigest.slice(0, 12),
    'gen_ai.tool.call.arguments': boundedPayload(toolArgumentsDetail(safeParse(input.argumentsJson)) ?? '{}'),
  };
}

function safeParse(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson);
  } catch {
    return argumentsJson;
  }
}

export function traced<T>(tracer: TraceTracer | undefined, name: string, attributes: TraceAttributes, work: () => Promise<T>): Promise<T> {
  if (!tracer) return work();
  return tracer.enterSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      return await work();
    } catch (error) {
      span.recordException?.({ name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message.slice(0, 300) : undefined });
      throw error;
    }
  });
}

export type ManualSpan = TraceSpan & { end(): unknown };

export type SpanStarter = { startSpan(name: string): ManualSpan };

type ChatResult = { usage?: { input: number; output: number }; stopReason?: string; errorMessage?: string };

export function chatSpanFinished(span: ManualSpan, result: ChatResult | undefined): void {
  span.setAttributes({
    'gen_ai.usage.input_tokens': result?.usage?.input,
    'gen_ai.usage.output_tokens': result?.usage?.output,
    'gen_ai.response.finish_reasons': result?.stopReason,
    'error.type': result?.stopReason === 'error' ? 'model_error' : undefined,
  });
  span.end();
}
