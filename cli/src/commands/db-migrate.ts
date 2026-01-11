import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  initDatabase,
  closeDatabase,
  getDb,
  isDatabaseConfigured,
  query,
} from '../infrastructure/database.js';
import { logInfo } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const dbMigrateCommand = new Command('db-migrate')
  .description('Run database migrations to set up the schema')
  .option('--check', 'Only check database connectivity without running migrations', false)
  .action(async (options) => {
    try {
      if (!isDatabaseConfigured()) {
        console.error(
          chalk.red(
            'Error: Database not configured. Set DATABASE_URL or POSTGRES_* environment variables.'
          )
        );
        process.exit(1);
      }

      logInfo(chalk.blue('Connecting to database...'));

      const connected = await initDatabase();
      if (!connected) {
        console.error(chalk.red('Error: Could not connect to database.'));
        process.exit(1);
      }

      if (options.check) {
        logInfo(chalk.green('✓ Database connection successful!'));
        await closeDatabase();
        return;
      }

      logInfo(chalk.blue('Running Drizzle migrations...'));

      const db = getDb();
      if (!db) {
        console.error(chalk.red('Error: Database instance not available.'));
        process.exit(1);
      }

      // Run Drizzle migrations
      const migrationsFolder = path.join(__dirname, '..', '..', 'drizzle');
      await migrate(db, { migrationsFolder });

      logInfo(chalk.green('✓ Migrations completed successfully!'));

      // Show table info
      const tableInfo = await query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'activities'
        ORDER BY ordinal_position
      `);

      logInfo(chalk.blue('\nActivities table schema:'));
      for (const row of tableInfo.rows) {
        const nullable = row.is_nullable === 'YES' ? chalk.gray('(nullable)') : '';
        logInfo(`  ${chalk.white(row.column_name)}: ${chalk.cyan(row.data_type)} ${nullable}`);
      }

      // Show index info
      const indexInfo = await query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'activities'
      `);

      logInfo(chalk.blue('\nIndexes:'));
      for (const row of indexInfo.rows) {
        logInfo(`  ${chalk.white(row.indexname)}`);
      }

      await closeDatabase();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red('Error running migrations:'), errorMessage);
      await closeDatabase();
      process.exit(1);
    }
  });
