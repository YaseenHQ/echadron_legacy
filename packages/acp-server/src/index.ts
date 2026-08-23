/**
 * ACP protocol-v2 server.
 *
 * The v2 surface reuses Echadron's SDK session/event mapping while owning the
 * v2 transport, message IDs, upsert semantics, and state updates. The CLI
 * selects this or the v1 adapter per connection from the initialize request.
 */

import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve as resolvePath } from 'node:path';

import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentConnection,
  type AgentContext,
  type AuthMethod,
  type InitializeResponse,
  type McpServer as V2McpServer,
  type SessionConfigOption,
  type SessionInfo,
  type SessionUpdate,
  type Stream,
} from '@agentclientprotocol/sdk-v2/experimental/v2';
import {
  AcpSession,
  ACP_BUILTIN_SLASH_COMMANDS,
  buildSessionConfigOptions,
  acpMcpServersToConfigs,
} from '@yaseenhq/acp-adapter';
import {
  type KimiHarness,
  type Session,
  type SessionStatus,
  type SessionSummary,
} from '@yaseenhq/echadron-sdk';

export interface AcpV2ServerOptions {
  readonly agentInfo?: { readonly name: string; readonly version: string };
  readonly terminalAuthEnv?: Readonly<Record<string, string>>;
  readonly terminalAuthCommand?: string;
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

export interface RunningAcpV2Server {
  readonly connection: AgentConnection;
  close(): Promise<void>;
}

type V2Client = AgentContext;

interface V2Session {
  readonly session: Session;
  adapter: AcpSession;
  client: V2Client;
  readonly cwd: string;
  readonly messageIds: {
    user?: string;
    agent?: string;
    thought?: string;
  };
  readonly messageContent: {
    agent: unknown[];
    thought: unknown[];
  };
  readonly terminals: Map<string, string>;
  readonly terminalReferences: Set<string>;
  promptActive: boolean;
  unsubscribe(): void;
}

const DEFAULT_AGENT_INFO = { name: 'Echadron', version: '0.0.0' } as const;

function authMethod(options: AcpV2ServerOptions): AuthMethod {
  const env = Object.entries(options.terminalAuthEnv ?? {}).map(([name, value]) => ({
    name,
    value,
  }));
  const method: AuthMethod = {
    type: 'terminal',
    methodId: 'echadron-oauth',
    name: 'Login with Echadron (OAuth)',
    description: 'Open Echadron’s OAuth login flow in a terminal.',
    args: ['--login'],
    ...(env.length > 0 ? { env } : {}),
  };
  if (options.terminalAuthCommand !== undefined && options.terminalAuthCommand.length > 0) {
    method._meta = {
      'terminal-auth': {
        type: 'terminal',
        command: options.terminalAuthCommand,
        args: ['login'],
        label: 'Login with Echadron (OAuth)',
      },
    };
  }
  return method;
}

function toAbsolutePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('ACP v2 requires a non-empty absolute path');
  }
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return value;
  throw new Error(`ACP v2 requires an absolute path: ${value}`);
}

function additionalDirectories(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError('ACP v2 additionalDirectories must be an array');
  }
  return value.map((directory) => toAbsolutePath(directory));
}

const SESSION_LIST_PAGE_SIZE = 100;

function decodeSessionListCursor(cursor: unknown): number {
  if (cursor === undefined || cursor === null) return 0;
  if (typeof cursor !== 'string' || cursor.length === 0) {
    throw new Error('Invalid ACP v2 session/list cursor');
  }
  try {
    const value = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid offset');
    return value;
  } catch {
    throw new Error('Invalid ACP v2 session/list cursor');
  }
}

function encodeSessionListCursor(offset: number): string {
  return Buffer.from(`${offset}`, 'utf8').toString('base64url');
}

function statusMode(status: SessionStatus): 'default' | 'plan' | 'auto' | 'yolo' {
  if (status.planMode) return 'plan';
  if (status.permission === 'auto') return 'auto';
  if (status.permission === 'yolo') return 'yolo';
  return 'default';
}

function sessionInfo(summary: SessionSummary): SessionInfo {
  return {
    sessionId: summary.id,
    cwd: toAbsolutePath(summary.workDir),
    ...(summary.additionalDirs !== undefined && summary.additionalDirs.length > 0
      ? { additionalDirectories: summary.additionalDirs.map(toAbsolutePath) }
      : {}),
    ...(summary.title !== undefined ? { title: summary.title } : {}),
    updatedAt: new Date(summary.updatedAt).toISOString(),
  };
}

function v2Content(block: unknown): unknown {
  // ACP v1 and v2 share the content-block shape for text, images and diffs.
  // Keep unknown blocks intact so future v2 content can pass through without
  // making the legacy event adapter depend on the draft schema.
  return block;
}

function v2ConfigOption(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const option = value as Record<string, unknown>;
  const configId = option['configId'] ?? option['id'];
  const normalized: Record<string, unknown> = { ...option, configId };
  delete normalized['id'];
  return normalized;
}

function v2ConfigOptions(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map(v2ConfigOption) : [];
}

function sessionPath(state: V2Session, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
    ? value
    : resolvePath(state.cwd, value);
}

/**
 * Convert the stable ACP tool-content union into the v2 union. In particular,
 * v1 diffs carried `oldText`/`newText`; v2 requires an authoritative `changes`
 * array even when no renderable patch is available.
 */
function v2ToolCallContent(value: unknown, state: V2Session): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const block = value as Record<string, unknown>;
  if (block['type'] === 'content' && 'content' in block) {
    return { ...block, content: v2Content(block['content']) };
  }
  if (block['type'] !== 'diff') return value;

  if (Array.isArray(block['changes'])) {
    const changes = block['changes'].map((change) => {
      if (typeof change !== 'object' || change === null) return change;
      const normalized = { ...(change as Record<string, unknown>) };
      if ('path' in normalized) {
        normalized['path'] = sessionPath(state, normalized['path']) ?? state.cwd;
      }
      if ('oldPath' in normalized) {
        normalized['oldPath'] = sessionPath(state, normalized['oldPath']) ?? state.cwd;
      }
      return normalized;
    });
    return { type: 'diff', changes };
  }

  const path = sessionPath(state, block['path']);
  if (path === undefined) {
    return {
      type: 'content',
      content: { type: 'text', text: 'A file diff was produced without a path.' },
    };
  }
  const operation =
    block['oldText'] === undefined
      ? 'add'
      : block['newText'] === undefined
        ? 'delete'
        : 'modify';
  return {
    type: 'diff',
    changes: [{ operation, path, fileType: 'text' }],
  };
}

function terminalCommand(rawInput: unknown): string | undefined {
  if (typeof rawInput === 'string') return rawInput;
  if (typeof rawInput !== 'object' || rawInput === null) return undefined;
  const value = rawInput as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'script']) {
    if (typeof value[key] === 'string' && value[key].length > 0) return value[key];
  }
  return undefined;
}

function terminalUpdateForToolCall(
  value: Record<string, unknown>,
  state: V2Session,
): Record<string, unknown> | undefined {
  const toolCallId = displayString(value['toolCallId'], '');
  if (toolCallId.length === 0) return undefined;
  const rawInput = value['rawInput'];
  const command = terminalCommand(rawInput);
  const knownTerminal = state.terminals.get(toolCallId);
  if (knownTerminal === undefined && command === undefined && value['kind'] !== 'execute') {
    return undefined;
  }
  const terminalId = knownTerminal ?? `${state.session.id}:terminal:${randomUUID()}`;
  state.terminals.set(toolCallId, terminalId);
  const update: Record<string, unknown> = {
    sessionUpdate: 'terminal_update',
    terminalId,
    ...(command !== undefined ? { command } : {}),
    cwd: state.cwd,
  };
  if (value['rawOutput'] !== undefined) {
    const output =
      typeof value['rawOutput'] === 'string'
        ? value['rawOutput']
        : typeof value['rawOutput'] === 'object' && value['rawOutput'] !== null
          ? [
              (value['rawOutput'] as Record<string, unknown>)['stdout'],
              (value['rawOutput'] as Record<string, unknown>)['stderr'],
            ]
              .filter((part): part is string => typeof part === 'string')
              .join('')
          : displayString(value['rawOutput'], '');
    update['output'] = { data: Buffer.from(output, 'utf8').toString('base64') };
  }
  if (value['status'] === 'completed' || value['status'] === 'failed' || value['status'] === 'cancelled') {
    update['exitStatus'] = {
      ...(value['status'] === 'completed' ? { exitCode: 0 } : {}),
      ...(value['status'] !== 'completed' ? { exitCode: 1 } : {}),
    };
  }
  return update;
}

function displayString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function isMainSessionEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return true;
  const agentId = (event as { readonly agentId?: unknown }).agentId;
  return agentId === undefined || agentId === 'main';
}

function legacyUpdateToV2(
  update: { readonly sessionUpdate?: string; readonly [key: string]: unknown },
  state: V2Session,
): SessionUpdate | undefined {
  const value = update as Record<string, unknown>;
  const kind = value['sessionUpdate'];
  if (kind === 'user_message_chunk') {
    state.messageIds.user ??= `${state.session.id}:user:${randomUUID()}`;
    return {
      sessionUpdate: 'user_message_chunk',
      messageId: state.messageIds.user,
      content: v2Content(value['content']) as never,
    };
  }
  if (kind === 'agent_message_chunk') {
    state.messageIds.agent ??= `${state.session.id}:agent:${randomUUID()}`;
    if (value['content'] !== undefined) {
      state.messageContent.agent.push(v2Content(value['content']));
    }
    return {
      sessionUpdate: 'agent_message_chunk',
      messageId: state.messageIds.agent,
      content: v2Content(value['content']) as never,
    };
  }
  if (kind === 'thinking_chunk' || kind === 'agent_thought_chunk') {
    state.messageIds.thought ??= `${state.session.id}:thought:${randomUUID()}`;
    if (value['content'] !== undefined) {
      state.messageContent.thought.push(v2Content(value['content']));
    }
    return {
      sessionUpdate: 'agent_thought_chunk',
      messageId: state.messageIds.thought,
      content: v2Content(value['content']) as never,
    };
  }
  if (kind === 'tool_call_content_chunk') {
    return {
      sessionUpdate: 'tool_call_content_chunk',
      toolCallId: displayString(value['toolCallId'], `${state.session.id}:tool`),
      content: v2ToolCallContent(value['content'], state) as never,
    } as SessionUpdate;
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const { sessionUpdate: _ignored, ...rest } = value;
    const content = Array.isArray(value['content'])
      ? value['content'].map((item) => v2ToolCallContent(item, state))
      : [];
    const toolCallId = displayString(value['toolCallId'], '');
    const terminalId = state.terminals.get(toolCallId);
    if (
      terminalId !== undefined &&
      (!state.terminalReferences.has(toolCallId) || content.length > 0)
    ) {
      content.push({ type: 'terminal', terminalId });
      state.terminalReferences.add(toolCallId);
    }
    return {
      sessionUpdate: 'tool_call_update',
      ...rest,
      toolCallId: displayString(value['toolCallId'], `${state.session.id}:tool`),
      ...(content.length > 0 ? { content: content as never } : {}),
    } as SessionUpdate;
  }
  if (kind === 'plan_update' || kind === 'plan') {
    const rawPlan = kind === 'plan_update' ? value['plan'] : undefined;
    const plan =
      rawPlan !== null && typeof rawPlan === 'object' && rawPlan !== undefined
        ? {
            ...(rawPlan as Record<string, unknown>),
            type: 'items',
            planId: displayString(
              (rawPlan as Record<string, unknown>)['planId'],
              `${state.session.id}:plan`,
            ),
          }
        : {
            type: 'items',
            planId: `${state.session.id}:plan`,
            entries: value['entries'] ?? [],
          };
    if (plan === undefined) return undefined;
    return {
      sessionUpdate: 'plan_update',
      plan: plan as never,
    } as SessionUpdate;
  }
  if (kind === 'available_commands_update') {
    const commands = (value['availableCommands'] ?? value['commands'] ?? []) as unknown[];
    return {
      sessionUpdate: 'available_commands_update',
      availableCommands: commands.map((command) => {
        if (typeof command !== 'object' || command === null) return command;
        const normalized = { ...(command as Record<string, unknown>) };
        const input = normalized['input'];
        if (typeof input === 'object' && input !== null && !('type' in input)) {
          normalized['input'] = { type: 'text', ...(input as Record<string, unknown>) };
        }
        return normalized;
      }) as never,
    } as SessionUpdate;
  }
  if (kind === 'config_option_update') {
    return {
      sessionUpdate: 'config_option_update',
      configOptions: v2ConfigOptions(value['configOptions']) as never,
    } as SessionUpdate;
  }
  if (kind === 'usage_update') {
    return { sessionUpdate: 'usage_update', ...value } as SessionUpdate;
  }
  return undefined;
}

function v2PermissionRequest(
  request: { sessionId: string; options: readonly unknown[]; toolCall: unknown },
  state: V2Session,
): Record<string, unknown> {
  const rawToolCall = request.toolCall as Record<string, unknown>;
  const toolCall: Record<string, unknown> = {
    ...rawToolCall,
    toolCallId: displayString(rawToolCall['toolCallId'], `${request.sessionId}:permission`),
    ...(Array.isArray(rawToolCall['content'])
      ? { content: rawToolCall['content'].map((item) => v2ToolCallContent(item, state)) }
      : {}),
  };
  return {
    sessionId: request.sessionId,
    title: `Allow ${displayString(toolCall['title'], 'this tool call')}?`,
    description:
      typeof toolCall['rawInput'] === 'string' ? toolCall['rawInput'] : undefined,
    subject: { type: 'tool_call', toolCall },
    options: request.options,
  };
}

function v1PermissionResponse(response: Record<string, unknown>): unknown {
  const outcome = response['outcome'] as Record<string, unknown> | undefined;
  if (outcome?.['outcome'] === 'selected' && typeof outcome['optionId'] === 'string') {
    return { outcome: { outcome: 'selected', optionId: outcome['optionId'] } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

function notifySessionUpdate(state: V2Session, update: SessionUpdate): void {
  void state.client
    .notify(methods.client.session.update, {
      sessionId: state.session.id,
      update,
    })
    .catch(() => undefined);
}

async function finishTurn(state: V2Session, reason: string | undefined): Promise<void> {
  if (state.messageIds.agent !== undefined && state.messageContent.agent.length > 0) {
    await state.client.notify(methods.client.session.update, {
      sessionId: state.session.id,
      update: {
        sessionUpdate: 'agent_message',
        messageId: state.messageIds.agent,
        content: state.messageContent.agent as never,
      },
    });
  }
  if (state.messageIds.thought !== undefined && state.messageContent.thought.length > 0) {
    await state.client.notify(methods.client.session.update, {
      sessionId: state.session.id,
      update: {
        sessionUpdate: 'agent_thought',
        messageId: state.messageIds.thought,
        content: state.messageContent.thought as never,
      },
    });
  }
  await state.client.notify(methods.client.session.update, {
    sessionId: state.session.id,
    update: {
      sessionUpdate: 'state_update',
      state: 'idle',
      stopReason:
        reason === 'cancelled'
          ? 'cancelled'
          : reason === 'blocked' || reason === 'refusal'
            ? 'refusal'
            : reason === 'max_tokens' || reason === 'max_turn_requests'
              ? reason
              : 'end_turn',
    },
  });
}

async function applyAdditionalDirectories(
  session: Session,
  requested: readonly string[] | undefined,
): Promise<void> {
  const target = (requested ?? []).map((directory) => toAbsolutePath(directory));
  await session.setAdditionalDirs(target);
}

function replayContentPart(part: unknown): unknown {
  if (typeof part !== 'object' || part === null) {
    return { type: 'text', text: displayString(part, '') };
  }
  const value = part as Record<string, unknown>;
  if (value['type'] === 'text' && typeof value['text'] === 'string') {
    return { type: 'text', text: value['text'] };
  }
  if (value['type'] === 'image_url' || value['type'] === 'audio_url') {
    const media = value['imageUrl'] ?? value['audioUrl'];
    if (typeof media === 'object' && media !== null && typeof (media as Record<string, unknown>)['url'] === 'string') {
      const url = (media as Record<string, unknown>)['url'] as string;
      const match = /^data:([^;]+);base64,(.*)$/.exec(url);
      if (match !== null) {
        return {
          type: value['type'] === 'image_url' ? 'image' : 'audio',
          mimeType: match[1],
          data: match[2],
        };
      }
    }
  }
  return {
    type: 'text',
    text: `[${displayString(value['type'], 'content')}]`,
  };
}

function replayMessageContent(parts: unknown): { content: unknown[]; thought: unknown[] } {
  const content: unknown[] = [];
  const thought: unknown[] = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (
      typeof part === 'object' &&
      part !== null &&
      (part as Record<string, unknown>)['type'] === 'think' &&
      typeof (part as Record<string, unknown>)['think'] === 'string'
    ) {
      thought.push({ type: 'text', text: (part as Record<string, unknown>)['think'] });
    } else {
      content.push(replayContentPart(part));
    }
  }
  return { content, thought };
}

async function replayV2History(state: V2Session): Promise<void> {
  const resumeState = state.session.getResumeState?.();
  const history = (resumeState as { agents?: Record<string, { context?: { history?: unknown[] } }> } | undefined)
    ?.agents?.['main']?.context?.history;
  if (!history) {
    await state.adapter.replayHistory();
    return;
  }

  for (const [index, rawMessage] of history.entries()) {
    if (typeof rawMessage !== 'object' || rawMessage === null) continue;
    const message = rawMessage as Record<string, unknown>;
    const role = message['role'];
    const { content, thought } = replayMessageContent(message['content']);
    if (role === 'user') {
      await state.client.notify(methods.client.session.update, {
        sessionId: state.session.id,
        update: {
          sessionUpdate: 'user_message',
          messageId: `${state.session.id}:replay:user:${index}`,
          content: content as never,
        },
      });
      continue;
    }
    if (role === 'assistant') {
      if (content.length > 0) {
        await state.client.notify(methods.client.session.update, {
          sessionId: state.session.id,
          update: {
            sessionUpdate: 'agent_message',
            messageId: `${state.session.id}:replay:agent:${index}`,
            content: content as never,
          },
        });
      }
      if (thought.length > 0) {
        await state.client.notify(methods.client.session.update, {
          sessionId: state.session.id,
          update: {
            sessionUpdate: 'agent_thought',
            messageId: `${state.session.id}:replay:thought:${index}`,
            content: thought as never,
          },
        });
      }
      const toolCalls = Array.isArray(message['toolCalls']) ? message['toolCalls'] : [];
      for (const rawToolCall of toolCalls) {
        if (typeof rawToolCall !== 'object' || rawToolCall === null) continue;
        const toolCall = rawToolCall as Record<string, unknown>;
        const toolCallId = displayString(
          toolCall['id'],
          `${state.session.id}:replay:tool:${index}`,
        );
        const display =
          typeof message['toolCallDisplays'] === 'object' && message['toolCallDisplays'] !== null
            ? (message['toolCallDisplays'] as Record<string, unknown>)[toolCallId]
            : undefined;
        const toolContent =
          typeof display === 'object' && display !== null && (display as Record<string, unknown>)['kind'] === 'diff'
            ? [
                v2ToolCallContent(
                  {
                    type: 'diff',
                    path: (display as Record<string, unknown>)['path'],
                    oldText: (display as Record<string, unknown>)['before'],
                    newText: (display as Record<string, unknown>)['after'],
                  },
                  state,
                ),
              ]
            : undefined;
        await state.client.notify(methods.client.session.update, {
          sessionId: state.session.id,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            title: displayString(toolCall['name'], 'Tool call'),
            status: 'completed',
            rawInput:
              typeof toolCall['arguments'] === 'string'
                ? (() => {
                    try {
                      return JSON.parse(toolCall['arguments']);
                    } catch {
                      return toolCall['arguments'];
                    }
                  })()
                : toolCall['arguments'],
            ...(toolContent !== undefined ? { content: toolContent as never } : {}),
          },
        });
      }
      continue;
    }
    if (role === 'tool') {
      const toolCallId = displayString(
        message['toolCallId'],
        `${state.session.id}:replay:tool:${index}`,
      );
      await state.client.notify(methods.client.session.update, {
        sessionId: state.session.id,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: message['isError'] === true ? 'failed' : 'completed',
          content: content.map((item) => ({ type: 'content', content: item })) as never,
        },
      });
    }
  }
}

function createLegacyConnection(state: V2Session): unknown {
  return {
    sessionUpdate: async (notification: { update: { readonly sessionUpdate?: string; readonly [key: string]: unknown } }) => {
      const rawUpdate = notification.update as Record<string, unknown>;
      if (rawUpdate['sessionUpdate'] === 'tool_call' || rawUpdate['sessionUpdate'] === 'tool_call_update') {
        const terminalUpdate = terminalUpdateForToolCall(rawUpdate, state);
        if (terminalUpdate !== undefined) {
          await state.client.notify(methods.client.session.update, {
            sessionId: state.session.id,
            update: terminalUpdate as never,
          });
        }
      }
      const update = legacyUpdateToV2(notification.update, state);
      if (update !== undefined) {
        await state.client.notify(methods.client.session.update, {
          sessionId: state.session.id,
          update,
        });
      }
    },
    requestPermission: async (request: { sessionId: string; options: readonly unknown[]; toolCall: unknown }) => {
      notifySessionUpdate(state, { sessionUpdate: 'state_update', state: 'requires_action' });
      const response = await state.client.request(
        methods.client.session.requestPermission,
        v2PermissionRequest(request, state) as never,
      );
      const outcome = (response as Record<string, unknown>)['outcome'];
      if (
        typeof outcome === 'object' &&
        outcome !== null &&
        (outcome as Record<string, unknown>)['outcome'] === 'selected'
      ) {
        notifySessionUpdate(state, { sessionUpdate: 'state_update', state: 'running' });
      }
      return v1PermissionResponse(response as Record<string, unknown>);
    },
  };
}

async function sessionOptions(
  harness: KimiHarness,
  state: V2Session,
): Promise<SessionConfigOption[]> {
  const status = await state.session.getStatus();
  const options = await buildSessionConfigOptions(
    harness,
    status.model ?? '',
    status.thinkingEffort,
    statusMode(status),
  );
  return options.map((option) => {
    return v2ConfigOption(option) as SessionConfigOption;
  });
}

async function createSessionState(
  harness: KimiHarness,
  client: V2Client,
  request: {
    cwd: string;
    additionalDirectories?: readonly string[];
    mcpServers?: readonly V2McpServer[];
  },
  existingSession?: Session,
): Promise<V2Session> {
  const cwd = toAbsolutePath(request.cwd);
  const session =
    existingSession ??
    (await harness.createSession({
      workDir: cwd,
      additionalDirs: additionalDirectories(request.additionalDirectories),
      ...(request.mcpServers === undefined
        ? {}
        : {
            mcpServers: acpMcpServersToConfigs(
              request.mcpServers as Parameters<typeof acpMcpServersToConfigs>[0],
            ),
          }),
    }));
  const status = await session.getStatus();
  const state = {
    session,
    adapter: undefined as unknown as AcpSession,
    client,
    cwd,
    messageIds: {},
    messageContent: { agent: [], thought: [] },
    terminals: new Map(),
    terminalReferences: new Set(),
    promptActive: false,
    unsubscribe: () => {},
  } as V2Session;
  state.adapter = new AcpSession(
    createLegacyConnection(state) as never,
    session,
    undefined,
    (event, properties) =>
      { harness.track(event, properties as Parameters<KimiHarness['track']>[1]); },
    status.model ?? '',
    harness,
    status.thinkingEffort,
  );
  const unsubscribe = session.onEvent((event: { type: string; reason?: string }) => {
    if (!isMainSessionEvent(event)) return;
    if (event.type === 'turn.started') {
      state.promptActive = true;
      state.messageIds.agent = undefined;
      state.messageIds.thought = undefined;
      state.messageContent.agent = [];
      state.messageContent.thought = [];
      notifySessionUpdate(state, { sessionUpdate: 'state_update', state: 'running' });
    } else if (event.type === 'turn.ended' && state.promptActive) {
      state.promptActive = false;
      void finishTurn(state, event.reason).catch(() => undefined);
    }
  });
  state.unsubscribe = unsubscribe;
  return state;
}

export function createAcpV2Agent(
  harness: KimiHarness,
  options: AcpV2ServerOptions = {},
): ReturnType<typeof agent> {
  const sessions = new Map<string, V2Session>();
  const app = agent();
  const info = options.agentInfo ?? DEFAULT_AGENT_INFO;

  app.onRequest(methods.agent.initialize, (): InitializeResponse => ({
    protocolVersion: PROTOCOL_VERSION,
    info,
    capabilities: { session: { delete: {}, additionalDirectories: {} } },
    authMethods: [authMethod(options)],
    _meta: { 'echadron:acp': { protocol: 'v2' } },
  }));

  app.onRequest(methods.agent.auth.login, async ({ params }) => {
    if (params.methodId !== 'echadron-oauth') {
      throw new Error(`Unknown Echadron auth method: ${params.methodId}`);
    }
    // `type: terminal` auth is completed by the client-launched
    // `echadron acp-v2 --login` subprocess. The protocol request itself is
    // still acknowledged so clients that report the completed terminal flow
    // through auth/login see a successful response.
    return {};
  });
  app.onRequest(methods.agent.auth.logout, async () => {
    await harness.auth.logout(undefined, { deprovisionConfig: false });
    return {};
  });

  app.onRequest(methods.agent.session.new, async ({ params, client }) => {
    const request = {
      ...params,
      additionalDirectories: additionalDirectories(params.additionalDirectories),
    };
    const state = await createSessionState(harness, client, request);
    await applyAdditionalDirectories(state.session, request.additionalDirectories);
    sessions.set(state.session.id, state);
    await client.notify(methods.client.session.update, {
      sessionId: state.session.id,
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: ACP_BUILTIN_SLASH_COMMANDS.map((command) => ({
          name: command.name,
          description: command.description,
          ...('input' in command
            ? {
                input:
                  typeof command.input === 'object' &&
                  command.input !== null &&
                  !('type' in command.input)
                    ? { type: 'text', ...command.input }
                    : command.input,
              }
            : {}),
        })),
      },
    });
    return {
      sessionId: state.session.id,
      configOptions: await sessionOptions(harness, state),
    };
  });

  app.onRequest(methods.agent.session.list, async ({ params }) => {
    const request = params as { cwd?: string | null; cursor?: string | null };
    const offset = decodeSessionListCursor(request.cursor);
    const summaries = await harness.listSessions(
      request.cwd === undefined || request.cwd === null
        ? {}
        : { workDir: toAbsolutePath(request.cwd) },
    );
    const page = summaries
      .map((summary) => sessions.get(summary.id)?.session.summary ?? summary)
      .slice(offset, offset + SESSION_LIST_PAGE_SIZE);
    return {
      sessions: page.map(sessionInfo),
      ...(offset + page.length < summaries.length
        ? { nextCursor: encodeSessionListCursor(offset + page.length) }
        : {}),
    };
  });

  app.onRequest(methods.agent.session.resume, async ({ params, client }) => {
    const request = params as {
      sessionId: string;
      cwd: string;
      additionalDirectories?: unknown;
      replayFrom?: { type: string } | null;
    };
    const requestedCwd = toAbsolutePath(request.cwd);
    const requestedAdditionalDirectories = additionalDirectories(request.additionalDirectories);
    if (request.replayFrom !== undefined && request.replayFrom !== null && request.replayFrom.type !== 'start') {
      throw new Error(`Unsupported ACP v2 replay cursor: ${request.replayFrom.type}`);
    }
    let state = sessions.get(request.sessionId);
    if (state !== undefined) {
      if (state.session.workDir !== requestedCwd) {
        throw new Error(
          `ACP v2 resume cwd does not match session cwd: ${requestedCwd} !== ${state.session.workDir}`,
        );
      }
      state.client = client;
      await applyAdditionalDirectories(state.session, requestedAdditionalDirectories);
    }
    if (state === undefined) {
      const session = await harness.resumeSession({
        id: request.sessionId,
        additionalDirs: requestedAdditionalDirectories,
      });
      if (session.workDir !== requestedCwd) {
        throw new Error(
          `ACP v2 resume cwd does not match session cwd: ${requestedCwd} !== ${session.workDir}`,
        );
      }
      state = await createSessionState(harness, client, {
        cwd: requestedCwd,
        additionalDirectories: requestedAdditionalDirectories,
      }, session);
      await applyAdditionalDirectories(state.session, requestedAdditionalDirectories);
      sessions.set(request.sessionId, state);
    }
    if (request.replayFrom?.type === 'start') await replayV2History(state);
    return { configOptions: await sessionOptions(harness, state) };
  });

  app.onRequest(methods.agent.session.prompt, async ({ params }) => {
    const request = params;
    const state = sessions.get(request.sessionId);
    if (state === undefined) throw new Error(`Session not found: ${request.sessionId}`);
    if (state.promptActive) throw new Error(`Session is already processing a prompt: ${request.sessionId}`);
    state.promptActive = true;
    state.messageIds.user = `${state.session.id}:user:${randomUUID()}`;
    try {
      await state.client.notify(methods.client.session.update, {
        sessionId: state.session.id,
        update: {
          sessionUpdate: 'user_message',
          messageId: state.messageIds.user,
          content: request.prompt as never,
        },
      });
    } catch (error) {
      state.promptActive = false;
      throw error;
    }
    void state.adapter
      .prompt(request.prompt as never)
      .then((response) => {
        // The adapter normally emits turn.ended, which owns the idle update.
        // A prompt can also finish before a turn exists (for example when a
        // cancellation races image compression), so do not leave the ACP
        // session stuck in a locally active state in that case.
        if (!state.promptActive) return;
        state.promptActive = false;
        void finishTurn(state, response.stopReason).catch(() => undefined);
      })
      .catch(() => {
        if (!state.promptActive) return;
        state.promptActive = false;
        notifySessionUpdate(state, {
          sessionUpdate: 'state_update',
          state: 'idle',
          stopReason: 'refusal',
        });
      });
    return {};
  });

  app.onNotification(methods.agent.session.cancel, async ({ params }) => {
    const state = sessions.get(params.sessionId);
    await state?.adapter.cancel();
    if (state?.promptActive === true) {
      state.promptActive = false;
      await finishTurn(state, 'cancelled');
    }
  });

  app.onRequest(methods.agent.session.close, async ({ params }) => {
    const state = sessions.get(params.sessionId);
    if (state !== undefined) {
      await state.adapter.cancel();
      state.unsubscribe();
      await harness.closeSession(params.sessionId);
      sessions.delete(params.sessionId);
    }
    return {};
  });

  app.onRequest(methods.agent.session.delete, async ({ params }) => {
    const state = sessions.get(params.sessionId);
    state?.unsubscribe();
    await harness.deleteSession(params.sessionId);
    sessions.delete(params.sessionId);
    return {};
  });

  app.onRequest(methods.agent.session.setConfigOption, async ({ params }) => {
    const request = params as { sessionId: string; configId: string; value: unknown; type: string };
    const state = sessions.get(request.sessionId);
    if (state === undefined) throw new Error(`Session not found: ${request.sessionId}`);
    if (request.configId === 'model' && typeof request.value === 'string') {
      await state.adapter.setModel(request.value);
    } else if (request.configId === 'thinking' && typeof request.value === 'string') {
      await state.adapter.setThinking(request.value);
    } else if (request.configId === 'mode' && typeof request.value === 'string') {
      await state.adapter.setMode(request.value as never);
    } else {
      throw new Error(`Unsupported session config option: ${request.configId}`);
    }
    return { configOptions: await sessionOptions(harness, state) };
  });

  return app;
}

export async function runAcpV2Server(
  harness: KimiHarness,
  options: AcpV2ServerOptions = {},
): Promise<void> {
  const running = startAcpV2Server(harness, options);
  try {
    await running.connection.closed;
  } finally {
    await running.close();
  }
}

export function startAcpV2Server(
  harness: KimiHarness,
  options: AcpV2ServerOptions = {},
): RunningAcpV2Server {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const stream: Stream = ndJsonStream(
    Writable.toWeb(output as Writable) as WritableStream<Uint8Array>,
    Readable.toWeb(input as Readable) as ReadableStream<Uint8Array>,
  );
  const connection = createAcpV2Agent(harness, options).connect(stream);
  return {
    connection,
    async close() {
      connection.close();
      await harness.close();
    },
  };
}
