import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import type { CreateApprovalRequestInput } from '../src/domain/approval.js';
import { ValidationError } from '../src/domain/errors.js';
import { SqliteApprovalRepository } from '../src/infra/repositories/sqlite-approval-repository.js';
import { DatabaseClient } from '../src/infra/storage/database.js';
import { ApprovalService } from '../src/services/approval-service.js';

test('approval repository atomically enforces pending and executing transitions', async (t) => {
  const repository = await createRepository(t);
  const first = await repository.create(createApprovalInput('first'));

  const claims = await Promise.all([
    repository.markExecuting(first.id, 'reviewer-a'),
    repository.markExecuting(first.id, 'reviewer-b'),
  ]);
  const acquiredClaims = claims.filter((claim) => claim !== null);

  assert.equal(acquiredClaims.length, 1);
  assert.equal(acquiredClaims[0]?.status, 'executing');
  assert.equal(
    await repository.resolve({
      expectedStatus: 'pending',
      id: first.id,
      resolvedBy: 'reviewer-c',
      status: 'denied',
    }),
    null,
  );

  const approved = await repository.resolve({
    expectedStatus: 'executing',
    id: first.id,
    resolvedBy: acquiredClaims[0]?.resolvedBy ?? 'reviewer-a',
    status: 'approved',
  });

  assert.equal(approved?.status, 'approved');
  assert.equal(await repository.markExecuting(first.id, 'reviewer-c'), null);
  assert.equal(
    await repository.resolve({
      expectedStatus: 'executing',
      id: first.id,
      resolvedBy: 'reviewer-c',
      status: 'failed',
    }),
    null,
  );

  const second = await repository.create(createApprovalInput('second'));
  const denied = await repository.resolve({
    expectedStatus: 'pending',
    id: second.id,
    resolutionNote: 'not allowed',
    resolvedBy: 'reviewer-a',
    status: 'denied',
  });

  assert.equal(denied?.status, 'denied');
  assert.equal(await repository.markExecuting(second.id, 'reviewer-b'), null);
});

test('concurrent approvals execute the protected action exactly once', async (t) => {
  const repository = await createRepository(t);
  const approval = await repository.create(createApprovalInput('race'));
  let executions = 0;

  const service = new ApprovalService({
    conversationService: {
      createMessage: async () => undefined,
      recordEvent: async () => undefined,
    },
    logger: testLogger(),
    repository,
    serverManagerService: {},
    sessionService: {},
    terminalService: {
      startCommand: async () => {
        executions += 1;
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    },
  } as never);

  const results = await Promise.allSettled([
    service.approve(approval.id, 'reviewer-a'),
    service.approve(approval.id, 'reviewer-b'),
  ]);
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.approve>>> =>
      result.status === 'fulfilled',
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  assert.equal(executions, 1);
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0]?.value.status, 'approved');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]?.reason instanceof ValidationError, true);
  assert.match(String(rejected[0]?.reason), /Approval "\d+" is already (approved|executing)/u);
  assert.equal((await repository.findById(approval.id))?.status, 'approved');
});

test('a failed approved action transitions only from executing to failed', async (t) => {
  const repository = await createRepository(t);
  const approval = await repository.create(createApprovalInput('failure'));
  const executionError = new Error('command failed safely');
  const service = new ApprovalService({
    conversationService: {
      createMessage: async () => undefined,
      recordEvent: async () => undefined,
    },
    logger: testLogger(),
    repository,
    serverManagerService: {},
    sessionService: {},
    terminalService: {
      startCommand: async () => {
        throw executionError;
      },
    },
  } as never);

  await assert.rejects(service.approve(approval.id, 'reviewer-a'), executionError);

  const failed = await repository.findById(approval.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.resolutionNote, executionError.message);
  assert.equal(
    await repository.resolve({
      expectedStatus: 'executing',
      id: approval.id,
      resolvedBy: 'reviewer-b',
      status: 'approved',
    }),
    null,
  );
});

async function createRepository(t: TestContext): Promise<SqliteApprovalRepository> {
  const directory = await mkdtemp(path.join(tmpdir(), 'asb-approval-test-'));
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const database = new DatabaseClient(path.join(directory, 'approvals.sqlite'), testLogger());
  return new SqliteApprovalRepository(database, testLogger());
}

function createApprovalInput(suffix: string): CreateApprovalRequestInput {
  return {
    description: `Execute terminal command ${suffix}`,
    payload: {
      command: 'npm test',
      sessionName: 'demo',
    },
    requestType: 'terminal_command',
    requestedBy: 'requester',
    riskLevel: 'high',
    title: `Terminal command ${suffix}`,
  };
}

function testLogger() {
  return {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  } as never;
}
