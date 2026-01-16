import { Command } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';
import * as chrono from 'chrono-node';
import { initDatabase, closeDatabase, isDatabaseConfigured } from '../infrastructure/database.js';
import { ActivityService } from '../core/activity-service.js';
import { IssuesConnector } from '../connectors/issues-connector.js';
import { PRsConnector } from '../connectors/prs-connector.js';
import { CommitsConnector } from '../connectors/commits-connector.js';
import type {
  ActivityConnector,
  ConnectorConfig,
  ConnectorResult,
} from '../core/activity-connector.js';
import type { UserActivity } from '../types.js';
import { logInfo } from '../logger.js';
import {
  loadConnectorsConfig,
  filterConfigByConnectors,
  getEnabledConnectors,
} from '../config/connectors.config.js';

/**
 * Unified command to sync all developer activities
 * Designed to run every 15 minutes via cron
 *
 * Collects:
 * - Issue changes (status, comment, label, etc.)
 * - PR changes (create, update, review)
 * - Commits
 *
 * Uses upsert logic to update existing activities
 */
export const syncActivitiesCommand = new Command('sync-activities')
  .description('Sync all developer activities from all sources (issues, PRs, commits)')
  .option('--from <date>', 'Start date (YYYY-MM-DD or "15 minutes ago")', '15 minutes ago')
  .option('--to <date>', 'End date (YYYY-MM-DD or "now")', 'now')
  .option(
    '--enabled-connectors <connectors>',
    'Comma-separated list of connectors to enable (issues,prs,commits). If not specified, uses config file defaults.',
    (value: string) => value.split(',').map((c) => c.trim())
  )
  .action(async (options, command) => {
    // Reject any positional arguments
    if (command.args && command.args.length > 0) {
      console.error(
        chalk.red(
          `Error: Too many arguments. This command only accepts options (flags), not positional arguments.\n` +
            `Usage: sync-activities [options]\n` +
            `Example: sync-activities --from "15 minutes ago" --to "now"`
        )
      );
      process.exit(1);
    }

    try {
      // Initialize database
      if (!isDatabaseConfigured()) {
        console.error(
          chalk.red(
            'Error: Database not configured. Set DATABASE_URL or POSTGRES_* environment variables.'
          )
        );
        process.exit(1);
      }

      const connected = await initDatabase();
      if (!connected) {
        console.error(chalk.red('Error: Could not connect to database.'));
        process.exit(1);
      }

      // Parse dates using chrono-node for natural language support
      const fromParsed = chrono.parseDate(options.from);
      if (!fromParsed) {
        console.error(chalk.red(`Error: Could not parse date: "${options.from}"`));
        process.exit(1);
      }
      const fromDate = dayjs(fromParsed);

      const toParsed = options.to === 'now' ? new Date() : chrono.parseDate(options.to);
      if (!toParsed) {
        console.error(chalk.red(`Error: Could not parse date: "${options.to}"`));
        process.exit(1);
      }
      const toDate = dayjs(toParsed);

      logInfo(
        chalk.blue(
          `\nSyncing activities from ${fromDate.format('YYYY-MM-DD HH:mm')} to ${toDate.format('YYYY-MM-DD HH:mm')}\n`
        )
      );

      // Load connector configuration
      const connectorsConfig = loadConnectorsConfig();

      // Filter by enabled connectors if specified
      const enabledConnectors = options.enabledConnectors || getEnabledConnectors(connectorsConfig);
      const filteredConfig = filterConfigByConnectors(connectorsConfig, enabledConnectors);

      logInfo(chalk.gray(`Enabled connectors: ${enabledConnectors.join(', ')}\n`));

      // Create connectors based on config
      const connectors: ActivityConnector[] = [];
      if (filteredConfig.issues?.enabled) {
        connectors.push(new IssuesConnector());
      }
      if (filteredConfig.prs?.enabled) {
        connectors.push(new PRsConnector());
      }
      if (filteredConfig.commits?.enabled) {
        connectors.push(new CommitsConnector());
      }

      // Build connector configuration for each connector type
      const config: ConnectorConfig = {
        enabled: true,
        from: fromDate,
        to: toDate,
        owner: filteredConfig.issues?.owner || filteredConfig.prs?.owner,
        projectNumber: filteredConfig.issues?.projectNumber,
        repo: filteredConfig.prs?.repo,
        repoDirectory: filteredConfig.commits?.repoDirectory,
      };

      // Collect activities from all connectors
      logInfo(chalk.blue('\nCollecting activities from connectors...\n'));
      const results: ConnectorResult[] = [];
      const allActivities: UserActivity[] = [];

      for (const connector of connectors) {
        logInfo(chalk.cyan(`Running ${connector.name} connector...`));

        try {
          const result = await connector.execute(config);
          results.push(result);

          if (result.success) {
            logInfo(chalk.green(`  ✓ ${result.connectorName}: ${result.count} activities`));
            allActivities.push(...result.activities);
          } else {
            logInfo(chalk.red(`  ✗ ${result.connectorName}: ${result.error || 'Unknown error'}`));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logInfo(chalk.red(`  ✗ ${connector.name}: ${errorMessage}`));
          results.push({
            activities: [],
            connectorName: connector.name,
            success: false,
            error: errorMessage,
            count: 0,
          });
        }
      }

      // Sort all activities by date
      allActivities.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Save activities using the service
      const service = new ActivityService();
      const saveResult = await service.saveActivities(allActivities);

      // Print summary
      logInfo(chalk.bold('\n=== Sync Summary ===\n'));

      logInfo(chalk.cyan('Connectors:'));
      for (const connectorResult of results) {
        if (connectorResult.success) {
          logInfo(
            chalk.green(`  ✓ ${connectorResult.connectorName}: ${connectorResult.count} activities`)
          );
        } else {
          logInfo(
            chalk.red(`  ✗ ${connectorResult.connectorName}: ${connectorResult.error || 'Failed'}`)
          );
        }
      }

      logInfo(chalk.cyan('\nDatabase:'));
      logInfo(chalk.green(`  ✓ Saved/Updated: ${saveResult.saved} activities`));
      if (saveResult.errors.length > 0) {
        logInfo(chalk.red(`  ✗ Errors: ${saveResult.errors.join(', ')}`));
      }

      logInfo(chalk.cyan('\nTotal:'));
      logInfo(chalk.bold(`  ${allActivities.length} activities processed\n`));

      await closeDatabase();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red('Error syncing activities:'), errorMessage);
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack));
      }
      await closeDatabase();
      process.exit(1);
    }
  });
