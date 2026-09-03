import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApprovalRequestRecord } from '../src/domain/approval.js';
import type { AgentType } from '../src/domain/agent.js';
import type { MachineRecord } from '../src/domain/machine.js';
import type { SessionRecord } from '../src/domain/session.js';
import { CommandRouter } from '../src/services/command-router.js';

test('parses natural language as an ask command', () => {
  const router = createRouter();

  assert.deepEqual(router.parse('看看这个项目是否闭环'), {
    name: 'ask',
    prompt: '看看这个项目是否闭环',
  });
});

test('parses quoted workspace paths and agent types for new sessions', () => {
  const router = createRouter();

  assert.deepEqual(router.parse('/new demo "/tmp/my project" gemini'), {
    agentType: 'gemini',
    name: 'new',
    sessionName: 'demo',
    workspacePath: '/tmp/my project',
  });
});

test('routes stop through approval instead of stopping immediately', async () => {
  const approval = createApproval({
    id: 42,
    requestType: 'session_stop',
    title: '停止会话 demo',
  });
  const calls: string[] = [];
  const router = createRouter({
    approvalService: {
      requestSessionStop: async (input: { actorId: string; sessionName: string }) => {
        calls.push(`${input.actorId}:${input.sessionName}`);
        return approval;
      },
    },
  });

  const output = await router.execute('/stop demo', { actorId: 'tester' });

  assert.deepEqual(calls, ['tester:demo']);
  assert.match(output, /Approval #42 requested/u);
});

function createRouter(overrides: Record<string, unknown> = {}): CommandRouter {
  const sessionService = {
    createSession: async (input: {
      actorId: string;
      agentType?: AgentType;
      name: string;
      workspacePath: string;
    }) =>
      createSession({
        agentType: input.agentType ?? 'codex',
        name: input.name,
        ownerActorId: input.actorId,
        workspacePath: input.workspacePath,
      }),
    getCurrentSession: async () => null,
    inspectCurrentSession: async () => {
      throw new Error('not implemented');
    },
    inspectSession: async () => {
      throw new Error('not implemented');
    },
    listSessions: async () => [],
    requireByName: async (name: string) => createSession({ name }),
    requireCurrentSession: async () => createSession({ name: 'current' }),
    renameSession: async (_oldName: string, newName: string) => createSession({ name: newName }),
    sendPrompt: async (input: { name: string }) => createSession({ name: input.name }),
    sendPromptToCurrent: async () => createSession({ name: 'current' }),
    setCurrentSession: async (_actorId: string, sessionName: string) =>
      createSession({ defaultForActor: true, name: sessionName }),
    tailCurrentSession: async () => '',
    tailSession: async () => '',
  };
  const approvalService = {
    approve: async (id: number) => createApproval({ id, status: 'approved' }),
    deny: async (id: number) => createApproval({ id, status: 'denied' }),
    listApprovals: async () => [],
    requestSessionStop: async (input: { sessionName: string }) =>
      createApproval({ requestType: 'session_stop', sessionName: input.sessionName }),
    requestTerminalCommand: async () => createApproval({ requestType: 'terminal_command' }),
  };
  const machineService = {
    listMachines: async () => [] as MachineRecord[],
    spawnSession: async (input: { name: string; workspacePath: string }) =>
      createSession({ name: input.name, workspacePath: input.workspacePath }),
  };
  const notificationService = {
    sendTestNotification: async () => ({ delivered: 0 }),
  };
  const supervisorService = {
    getState: () => ({ latestSnapshots: [] }),
    runInspectionCycle: async () => [],
  };
  const terminalService = {
    assessCommandRisk: () => ({ reason: 'test', requiresApproval: false, riskLevel: 'low' }),
    cancelCommand: async () => {
      throw new Error('not implemented');
    },
    getCommand: async () => {
      throw new Error('not implemented');
    },
    startCommand: async () => {
      throw new Error('not implemented');
    },
  };
  const workspaceService = {
    getGitDiff: async () => ({ available: true, content: '', path: null }),
    getGitStatus: async () => ({ available: true, branch: 'main', clean: true, entries: [] }),
    listFiles: async () => ({ entries: [], path: '' }),
    readFilePreview: async () => ({ content: '', isBinary: false, path: 'README.md', size: 0 }),
  };

  const options = {
    approvalService,
    machineService,
    notificationService,
    sessionService,
    supervisorService,
    terminalService,
    workspaceService,
    ...overrides,
  };

  return new CommandRouter(options as unknown as ConstructorParameters<typeof CommandRouter>[0]);
}

function createSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    agentType: 'codex',
    createdAt: '2026-05-11T00:00:00.000Z',
    defaultForActor: false,
    id: 1,
    lastActiveAt: '2026-05-11T00:00:00.000Z',
    lastOutputDigest: null,
    name: 'demo',
    ownerActorId: 'tester',
    status: 'idle',
    tmuxSessionName: 'codex-hub',
    tmuxWindowName: 'demo',
    updatedAt: '2026-05-11T00:00:00.000Z',
    workspacePath: '/tmp/demo',
    ...overrides,
  };
}

function createApproval(overrides: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord {
  return {
    createdAt: '2026-05-11T00:00:00.000Z',
    dedupeKey: null,
    description: 'approval description',
    expiresAt: null,
    id: 1,
    payload: {},
    requestType: 'session_stop',
    requestedBy: 'tester',
    resolutionNote: null,
    resolvedAt: null,
    resolvedBy: null,
    riskLevel: 'high',
    sessionId: 1,
    sessionName: 'demo',
    status: 'pending',
    title: 'approval title',
    ...overrides,
  };
}
