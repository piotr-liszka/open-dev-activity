import { Command } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';
import { initDatabase, closeDatabase, isDatabaseConfigured } from '../infrastructure/database.js';
import {
  findActivities,
  countActivities,
  type ActivityQueryOptions,
} from '../infrastructure/activity-repository.js';
import { logInfo } from '../logger.js';

export const queryActivitiesCommand = new Command('query-activities')
  .description('Query stored activities from the database')
  .option('--author <string>', 'Filter by author')
  .option('--repository <string>', 'Filter by repository')
  .option('--type <string>', 'Filter by activity type (commit, pr_created, pr_review, etc.)')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--limit <number>', 'Maximum number of results', '100')
  .option('--offset <number>', 'Skip first N results', '0')
  .option('--count-only', 'Only show count, not full results', false)
  .option('--format <string>', 'Output format: json, table', 'json')
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

      const connected = await initDatabase();
      if (!connected) {
        console.error(chalk.red('Error: Could not connect to database.'));
        process.exit(1);
      }

      // Build query options
      const queryOptions: ActivityQueryOptions = {
        limit: parseInt(options.limit, 10),
        offset: parseInt(options.offset, 10),
      };

      if (options.author) {
        queryOptions.author = options.author;
      }

      if (options.repository) {
        queryOptions.repository = options.repository;
      }

      if (options.type) {
        queryOptions.type = options.type;
      }

      if (options.from) {
        queryOptions.fromDate = dayjs(options.from).toDate();
      }

      if (options.to) {
        queryOptions.toDate = dayjs(options.to).toDate();
      }

      // Log query info
      logInfo(chalk.blue('Querying activities...'));
      if (options.author) logInfo(chalk.gray(`  Author: ${options.author}`));
      if (options.repository) logInfo(chalk.gray(`  Repository: ${options.repository}`));
      if (options.type) logInfo(chalk.gray(`  Type: ${options.type}`));
      if (options.from) logInfo(chalk.gray(`  From: ${options.from}`));
      if (options.to) logInfo(chalk.gray(`  To: ${options.to}`));

      if (options.countOnly) {
        const count = await countActivities(queryOptions);
        logInfo(chalk.green(`\nTotal activities: ${count}`));
        await closeDatabase();
        return;
      }

      const activities = await findActivities(queryOptions);
      const totalCount = await countActivities(queryOptions);

      logInfo(chalk.green(`\nFound ${activities.length} activities (total: ${totalCount})\n`));

      if (options.format === 'table') {
        // Table format output
        for (const activity of activities) {
          const date = dayjs(activity.date).format('YYYY-MM-DD HH:mm');
          const typeColor = getTypeColor(activity.type);

          console.log(
            `${chalk.gray(date)} ${typeColor(activity.type.padEnd(20))} ${chalk.white(activity.author.padEnd(20))} ${chalk.cyan(activity.repository)}`
          );
          if (activity.title) {
            console.log(`  ${chalk.gray(activity.title)}`);
          }
        }
      } else {
        // JSON format output
        console.log(JSON.stringify(activities, null, 2));
      }

      await closeDatabase();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red('Error querying activities:'), errorMessage);
      await closeDatabase();
      process.exit(1);
    }
  });

function getTypeColor(type: string): (text: string) => string {
  switch (type) {
    case 'commit':
      return chalk.green;
    case 'pr_created':
      return chalk.blue;
    case 'pr_review':
      return chalk.magenta;
    case 'pr_comment':
      return chalk.cyan;
    case 'issue_status_change':
      return chalk.yellow;
    case 'issue_assignment':
      return chalk.yellow;
    case 'issue_labeling':
      return chalk.yellow;
    case 'issue_state_change':
      return chalk.red;
    default:
      return chalk.gray;
  }
}
