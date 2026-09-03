import type { Logger } from 'pino';

import type {
  ButlerOverview,
  ManagedServerDoctorResult,
  ManagedServiceCommandResult,
  ManagedServiceLiveStatus,
  ManagedServiceLogs,
} from '../domain/butler.js';
import { ApprovalService } from './approval-service.js';
import { AgentRuntimeService } from './agent-runtime-service.js';
import { MachineService } from './machine-service.js';
import { ServerManagerService } from './server-manager-service.js';
import { SessionService } from './session-service.js';

type ButlerServiceOptions = {
  approvalService: ApprovalService;
  agentRuntimeService: AgentRuntimeService;
  logger: Logger;
  machineService: MachineService;
  serverManagerService: ServerManagerService;
  sessionService: SessionService;
};

export class ButlerService {
  constructor(private readonly options: ButlerServiceOptions) {}

  async getOverview(): Promise<ButlerOverview> {
    const [machines, sessions, serverManager, managedServers, approvals] = await Promise.all([
      this.options.machineService.listMachines(),
      this.options.sessionService.listSessions(),
      this.options.serverManagerService.getIntegrationStatus(),
      this.options.serverManagerService.listManagedServers().catch(() => []),
      this.options.approvalService.listApprovals({
        limit: 200,
        status: 'pending',
      }),
    ]);

    const sessionCounts = sessions.reduce<Record<string, number>>((accumulator, session) => {
      accumulator[session.agentType] = (accumulator[session.agentType] ?? 0) + 1;
      return accumulator;
    }, {});
    const runtimes = await this.options.agentRuntimeService.listRuntimes(sessionCounts);

    this.options.logger.debug(
      {
        managedServerCount: managedServers.length,
        machineCount: machines.length,
        sessionCount: sessions.length,
      },
      'butler overview resolved',
    );

    return {
      generatedAt: new Date().toISOString(),
      machines,
      managedServers,
      pendingApprovals: approvals.length,
      runtimes,
      serverManager,
      sessions,
    };
  }

  async getManagedServiceStatus(
    serverName: string,
    projectName: string,
  ): Promise<ManagedServiceLiveStatus> {
    return this.options.serverManagerService.getServiceStatus(serverName, projectName);
  }

  async getManagedServiceLogs(
    serverName: string,
    projectName: string,
    lines = 120,
  ): Promise<ManagedServiceLogs> {
    return this.options.serverManagerService.getServiceLogs(serverName, projectName, lines);
  }

  async doctorManagedServer(serverName: string): Promise<ManagedServerDoctorResult> {
    return this.options.serverManagerService.doctorServer(serverName);
  }

  async executeManagedCommand(
    serverName: string,
    projectName: string,
    command: string,
  ): Promise<ManagedServiceCommandResult> {
    return this.options.serverManagerService.executeProjectCommand(serverName, projectName, command);
  }
}
