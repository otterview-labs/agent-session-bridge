import { spawn } from 'node:child_process';

import { CommandExecutionError } from '../../domain/errors.js';

export type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export type RunCommandOptions = {
  allowNonZero?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputCharacters?: number;
};

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk.toString(), options.maxOutputCharacters);
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk.toString(), options.maxOutputCharacters);
    });

    child.on('error', (error) => {
      reject(
        new CommandExecutionError(
          `Failed to execute "${command}": ${error.message}`,
          stdout.trimEnd(),
          stderr.trimEnd(),
          -1,
        ),
      );
    });

    child.on('close', (code) => {
      const exitCode = code ?? -1;
      const result = {
        exitCode,
        stderr: stderr.trimEnd(),
        stdout: stdout.trimEnd(),
      };

      if (exitCode === 0 || options.allowNonZero) {
        resolve(result);
        return;
      }

      reject(
        new CommandExecutionError(
          `Command "${command}" exited with code ${exitCode}`,
          result.stdout,
          result.stderr,
          exitCode,
        ),
      );
    });
  });
}

function appendOutput(
  current: string,
  addition: string,
  maximum: number | undefined,
): string {
  if (maximum === undefined) {
    return `${current}${addition}`;
  }

  if (current.length >= maximum) {
    return current;
  }

  return `${current}${addition}`.slice(0, maximum);
}
