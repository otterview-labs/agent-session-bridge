import type { AgentType } from './agent.js';
import type { MachineRecord } from './machine.js';
import type { SessionRecord } from './session.js';

export const AGENT_RUNTIME_STATUSES = [
  'available',
  'missing',
] as const;

export type AgentRuntimeStatus = (typeof AGENT_RUNTIME_STATUSES)[number];

export type AgentRuntimeRecord = {
  agentType: AgentType;
  binary: string | null;
  command: string;
  detectedPath: string | null;
  installed: boolean;
  sessionCount: number;
  spawnSupported: boolean;
  status: AgentRuntimeStatus;
  summary: string;
  title: string;
};

export const MANAGED_SERVICE_STATUSES = [
  'configured',
  'running',
  'stopped',
  'connection_failed',
  'error',
  'unknown',
] as const;

export type ManagedServiceStatus = (typeof MANAGED_SERVICE_STATUSES)[number];

export type ManagedServiceAction = 'exec' | 'logs' | 'restart' | 'start' | 'status' | 'stop';

export type ManagedServiceLiveStatus = {
  checkedAt: string;
  projectName: string;
  rawOutput: string;
  serverName: string;
  status: ManagedServiceStatus;
  summary: string;
};

export type ManagedServiceLogs = {
  content: string;
  fetchedAt: string;
  lines: number;
  projectName: string;
  serverName: string;
};

export type ManagedServiceRecord = {
  actions: ManagedServiceAction[];
  description: string | null;
  frpRemotePort: number | null;
  healthCheckUrl: string | null;
  host: string;
  id: string;
  lastStatus: ManagedServiceLiveStatus | null;
  logFile: string | null;
  name: string;
  port: number | null;
  projectName: string;
  remotePath: string | null;
  serverName: string;
  sshPort: number;
  tags: string[];
};

export type ManagedServerRecord = {
  configPath: string;
  description: string | null;
  host: string;
  name: string;
  port: number;
  projects: ManagedServiceRecord[];
  repoPath: string;
  tags: string[];
};

export type ManagedServerDoctorResult = {
  checkedAt: string;
  ok: boolean;
  rawOutput: string;
  serverName: string;
  summary: string;
};

export type ManagedServiceCommandResult = {
  executedAt: string;
  exitCode: number;
  projectName: string;
  rawOutput: string;
  serverName: string;
  summary: string;
};

export type ServerManagerIntegrationStatus = {
  available: boolean;
  configPath: string;
  reason: string | null;
  repoPath: string;
};

export type ButlerOverview = {
  generatedAt: string;
  machines: MachineRecord[];
  managedServers: ManagedServerRecord[];
  pendingApprovals: number;
  runtimes: AgentRuntimeRecord[];
  serverManager: ServerManagerIntegrationStatus;
  sessions: SessionRecord[];
};
