import { splitCommandLine } from './shell.js';

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=.*/u;

export function extractCommandBinary(commandLine: string): string | null {
  const trimmed = commandLine.trim();

  if (!trimmed) {
    return null;
  }

  const tokens = splitCommandLine(trimmed);

  if (tokens.length === 0) {
    return null;
  }

  let index = 0;

  if (tokens[0] === 'env' || tokens[0]?.endsWith('/env')) {
    index = 1;

    while (index < tokens.length) {
      const token = tokens[index]!;

      if (token === '-u' || token === '--unset') {
        index += 2;
        continue;
      }

      if (token.startsWith('-')) {
        index += 1;
        continue;
      }

      if (ENV_ASSIGNMENT.test(token)) {
        index += 1;
        continue;
      }

      return token;
    }

    return null;
  }

  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index]!)) {
    index += 1;
  }

  return tokens[index] ?? null;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
