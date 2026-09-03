import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHighRiskTerminalCommand,
  isReadOnlyTerminalCommand,
  TerminalService,
} from '../src/services/terminal-service.js';

test('classifies read-only terminal commands as directly runnable', () => {
  const service = createTerminalService();

  assert.deepEqual(service.assessCommandRisk('uptime'), {
    reason: '只读命令，可直接执行',
    requiresApproval: false,
    riskLevel: 'low',
  });
});

test('classifies destructive terminal commands as high risk', () => {
  const service = createTerminalService();

  assert.equal(isHighRiskTerminalCommand('rm -rf dist'), true);
  assert.equal(isHighRiskTerminalCommand('git reset --hard HEAD'), true);
  assert.deepEqual(service.assessCommandRisk('rm -rf dist'), {
    reason: '命令可能修改文件、仓库或系统状态，需要显式审批',
    requiresApproval: true,
    riskLevel: 'high',
  });
});

test('classifies unknown write-capable commands as medium risk', () => {
  const service = createTerminalService();

  assert.deepEqual(service.assessCommandRisk('npm install'), {
    reason: '命令不是只读操作，按保守策略进入审批',
    requiresApproval: true,
    riskLevel: 'medium',
  });
});

test('requires approval for shell composition and expansion', () => {
  const service = createTerminalService();
  const unsafeCommands = [
    'ls ; touch /tmp/pwned',
    'git status && git commit -am bypass',
    'find . -exec touch {} +',
    'cat .env',
    'ls $(touch /tmp/pwned)',
    'ls `touch /tmp/pwned`',
    'rg TODO src | tee /tmp/results',
    'git diff > /tmp/diff',
    'cat < .env',
    'ls\n touch /tmp/pwned',
  ];

  for (const command of unsafeCommands) {
    assert.equal(isReadOnlyTerminalCommand(command), false, command);
    assert.equal(service.assessCommandRisk(command).requiresApproval, true, command);
  }
});

test('requires approval for write-capable read-command variants', () => {
  const unsafeCommands = [
    'find . -delete',
    'find . -ok touch {} +',
    "sed -i 's/foo/bar/' README.md",
    "sed -n 's/foo/bar/w /tmp/output' README.md",
    "sed -n 's/foo/bar/e' README.md",
    'rg --pre touch .',
    'hostname attacker-controlled-name',
    'tree -o /tmp/tree.txt',
    'head .env',
    "sed -n '1p' .env",
    'rg . .env',
    'git show HEAD:.env',
    'tail /home/example/.ssh/id_ed25519',
    'cat /proc/self/environ',
    'head ../outside.txt',
    'ps eww',
    'grep -R token .',
    'rg --hidden token .',
    'rg -uuu token .',
    'journalctl --vacuum-time=1s',
    'git diff --stat',
    'git status --short',
    'git log -p',
    'git show HEAD',
    'find . -name README.md',
    'cat README.md',
    'head README.md',
    'tail README.md',
    'grep Agent README.md',
    'rg --files src',
    "sed -n '1p' README.md",
    'ls',
    'stat README.md',
    'tree',
    'lsof',
    'ss -K dst 127.0.0.1',
    'ps -eEww',
    'docker ps',
    'docker compose ps',
    'free',
    'systemctl status',
    'systemctl status --host=evil.example',
    'df --sync',
    'ps aux',
    'ps',
    'PWD',
    'UNAME -a',
    'Hostname',
  ];

  for (const command of unsafeCommands) {
    assert.equal(isReadOnlyTerminalCommand(command), false, command);
  }
});

test('keeps ordinary inspection commands directly runnable', () => {
  const safeCommands = [
    'hostname',
    'uname -a',
    'uptime',
    'pwd',
    'df',
  ];

  for (const command of safeCommands) {
    assert.equal(isReadOnlyTerminalCommand(command), true, command);
  }
});

function createTerminalService(): TerminalService {
  return new TerminalService({
    commandTimeoutMs: 1000,
    conversationService: {} as never,
    logger: {
      info: () => undefined,
    } as never,
    maxOutputCharacters: 1000,
    repository: {} as never,
    sessionEventBus: {} as never,
    sessionService: {} as never,
  });
}
