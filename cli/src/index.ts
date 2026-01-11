#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { fetchIssuesCommand } from './commands/fetch-issues.js';
import { fetchPRsCommand } from './commands/fetch-prs.js';
import { analyseReposCommand } from './commands/analyse-repos.js';
import { dbMigrateCommand } from './commands/db-migrate.js';
import { queryActivitiesCommand } from './commands/query-activities.js';
import { initDatabase, closeDatabase, isDatabaseConfigured } from './infrastructure/database.js';
import { registerActivityHandlers } from './infrastructure/activity-handler.js';

dotenv.config();

const program = new Command();

program.name('cli').description('GitHub Project CLI').version('1.0.0');

program.addCommand(fetchIssuesCommand);
program.addCommand(fetchPRsCommand);
program.addCommand(analyseReposCommand);
program.addCommand(dbMigrateCommand);
program.addCommand(queryActivitiesCommand);

// Initialize database and register handlers before running commands
async function main() {
  // Initialize database if configured
  if (isDatabaseConfigured()) {
    await initDatabase();
    registerActivityHandlers();
  }

  // Handle graceful shutdown
  const cleanup = async () => {
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Parse and execute command
  await program.parseAsync(process.argv);

  // Close database after command execution
  await closeDatabase();
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await closeDatabase();
  process.exit(1);
});
