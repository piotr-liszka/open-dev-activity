#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { queryActivitiesCommand } from './commands/query-activities.js';
import { syncActivitiesCommand } from './commands/sync-activities.js';

dotenv.config();

const program = new Command();

program.name('cli').description('Developer Activity Monitor CLI').version('1.0.0');

program.addCommand(queryActivitiesCommand);
program.addCommand(syncActivitiesCommand);

// Initialize database and register handlers before running commands
async function main() {

  // Handle graceful shutdown
  const cleanup = async () => {
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Parse and execute command
  await program.parseAsync(process.argv);

}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
