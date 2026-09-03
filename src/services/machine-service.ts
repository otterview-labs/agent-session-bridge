import os from 'node:os';

import type { Logger } from 'pino';

import type { AgentType } from '../domain/agent.js';
import type { MachineRecord } from '../domain/machine.js';
import { DomainError, NotFoundError } from '../domain/errors.js';
import type { MachineRepository } from '../infra/repositories/machine-repository.js';
import { AgentRuntimeService } from './agent-runtime-service.js';
import { ConversationService } from './conversation-service.js';
import { SessionService } from './session-service.js';

type MachineServiceOptions = {
  agentRuntimeService: AgentRuntimeService;
  conversationService: ConversationService;
  logger: Logger;
  repository: MachineRepository;
  sessionService: SessionService;
};

export class MachineService {
  constructor(private readonly options: MachineServiceOptions) {}

  async registerLocalMachine(): Promise<MachineRecord> {
    const runtimes = await this.options.agentRuntimeService.listRuntimes();
    const installedAgentTypes = runtimes
      .filter((runtime) => runtime.installed)
      .map((runtime) => runtime.agentType);
    const machine = await this.options.repository.upsert({
      capabilities: {
        agentTypes: runtimes.map((runtime) => runtime.agentType),
        approvals: true,
        files: true,
        installedAgentTypes,
        managedServices: true,
        sessions: true,
        spawn: true,
        terminal: true,
      },
      host: os.hostname(),
      labels: ['local', 'tmux', ...installedAgentTypes],
      lastSeenAt: new Date().toISOString(),
      name: 'local',
      namespace: 'default',
      runnerVersion: `node-${process.version}`,
      status: 'online',
    });

    await this.options.conversationService.recordEvent({
      actorId: 'system',
      eventType: 'machine.online',
      payload: {
        host: machine.host,
        machineId: machine.id,
        name: machine.name,
      },
    });
    this.options.logger.info({ machineId: machine.id }, 'local machine registered');
    return machine;
  }

  async listMachines(): Promise<MachineRecord[]> {
    return this.options.repository.findAll();
  }

  async registerMachine(input: {
    capabilities?: MachineRecord['capabilities'];
    host?: string | null;
    labels?: string[];
    name: string;
    namespace?: string;
    runnerVersion?: string | null;
    status?: MachineRecord['status'];
  }): Promise<MachineRecord> {
    const machine = await this.options.repository.upsert({
      capabilities: input.capabilities,
      host: input.host ?? null,
      labels: input.labels ?? [],
      lastSeenAt: new Date().toISOString(),
      name: input.name,
      namespace: input.namespace ?? 'default',
      runnerVersion: input.runnerVersion ?? null,
      status: input.status ?? 'online',
    });

    await this.options.conversationService.recordEvent({
      actorId: 'system',
      eventType: machine.status === 'online' ? 'machine.online' : 'machine.offline',
      payload: {
        machineId: machine.id,
        name: machine.name,
        status: machine.status,
      },
    });
    return machine;
  }

  async heartbeat(id: number): Promise<MachineRecord> {
    const machine = await this.options.repository.findById(id);

    if (!machine) {
      throw new NotFoundError(`Machine "${id}" was not found`);
    }

    return this.options.repository.heartbeat(id, 'online', new Date().toISOString());
  }

  async spawnSession(input: {
    actorId: string;
    agentType?: AgentType;
    machineId: number;
    name: string;
    workspacePath: string;
  }) {
    const machine = await this.options.repository.findById(input.machineId);

    if (!machine) {
      throw new NotFoundError(`Machine "${input.machineId}" was not found`);
    }

    if (machine.status !== 'online') {
      throw new DomainError(`Machine "${machine.name}" is currently ${machine.status}`);
    }

    if (machine.name !== 'local') {
      throw new DomainError('Remote runner spawn is not wired yet; only local machine is supported');
    }

    const session = await this.options.sessionService.createSession({
      actorId: input.actorId,
      agentType: input.agentType ?? 'codex',
      name: input.name,
      workspacePath: input.workspacePath,
    });

    await this.options.conversationService.recordEvent({
      actorId: input.actorId,
      eventType: 'session.spawned',
      payload: {
        agentType: session.agentType,
        machineId: machine.id,
        machineName: machine.name,
      },
      sessionId: session.id,
      sessionName: session.name,
    });

    return session;
  }
}
