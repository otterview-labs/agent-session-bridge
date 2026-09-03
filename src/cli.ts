#!/usr/bin/env node

import process from 'node:process';

import { createApplication } from './app/bootstrap.js';

async function main(): Promise<void> {
  const app = createApplication();
  const rawInput = process.argv.slice(2).join(' ').trim();

  if (!rawInput) {
    console.log(app.commandRouter.renderHelp());
    return;
  }

  try {
    const output = await app.commandRouter.execute(rawInput, {
      actorId: 'local-cli',
    });
    console.log(output);
  } catch (error) {
    app.logger.error({ err: error }, 'command failed');
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

void main();
