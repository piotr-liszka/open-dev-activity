import { Command } from 'commander';
import chalk from 'chalk';
import { GitHubClient } from '../github.js';
import type {
  ProjectV2Item,
  ProcessedIssue,
  StatusDuration,
  IssueHistoryItem,
  UserActivity,
  ActivityType,
} from '../types.js';
import dayjs from 'dayjs';
import { getGitHubToken } from '../auth.js';
import { calculateWorkingTime } from '../core/working-time.js';
import { logInfo } from '../logger.js';

export const fetchIssuesCommand = new Command('fetch-issues')
  .description('Fetch issues from a GitHub ProjectV2 with status history and details')
  .option('--owner <string>', 'GitHub Organization or User', process.env.GITHUB_OWNER)
  .option('--project-number <number>', 'ProjectV2 Number', process.env.PROJECT_NUMBER)
  .option('--from <date>', 'Start date (YYYY-MM-DD)', process.env.DATE_FROM || '24 hours ago')
  .option('--to <date>', 'End date (YYYY-MM-DD)', process.env.DATE_TO || 'now')
  .action(async (options) => {
    try {
      if (!options.owner) {
        console.error(
          chalk.red('Error: Owner is required. Provide via --owner or GITHUB_OWNER env var.')
        );
        process.exit(1);
      }
      if (!options.projectNumber) {
        console.error(
          chalk.red(
            'Error: Project number is required. Provide via --project-number or PROJECT_NUMBER env var.'
          )
        );
        process.exit(1);
      }

      const authResult = await getGitHubToken();
      if (!authResult) {
        console.error(chalk.red('Error: GITHUB_TOKEN or GitHub App credentials are required.'));
        process.exit(1);
      }
      const { token, method } = authResult;

      const client = new GitHubClient(token);

      // Get user info to show who we are acting as
      // This is useful for debugging permissions or knowing if we are a bot vs user
      const whoami = await client.getAuthenticatedUser();

      logInfo(
        chalk.gray(`Authenticated as: `) +
          chalk.whiteBright.bold(whoami) +
          chalk.gray(` (via ${method})`)
      );

      logInfo(
        chalk.blue(`Fetching issues for ${options.owner}/Project-${options.projectNumber}...`)
      );

      // Parse dates
      let fromDate = dayjs(options.from);
      if (options.from === '24 hours ago') {
        fromDate = dayjs().subtract(24, 'hour');
      } else if (options.from === '7 days ago') {
        fromDate = dayjs().subtract(7, 'day');
      }
      const toDate = options.to === 'now' ? dayjs() : dayjs(options.to);

      logInfo(
        chalk.gray(
          `Time Range: ${fromDate.format('YYYY-MM-DD HH:mm')} to ${toDate.format('YYYY-MM-DD HH:mm')}`
        )
      );

      // Construct filter for GraphQL
      // Format: updated:YYYY-MM-DD..YYYY-MM-DD or updated:>=YYYY-MM-DD
      let filter = `updated:>=${fromDate.format('YYYY-MM-DD')}`;
      if (options.to !== 'now') {
        filter = `updated:${fromDate.format('YYYY-MM-DD')}..${toDate.format('YYYY-MM-DD')}`;
      }

      const items = await client.fetchProjectItems({
        owner: options.owner,
        projectNumber: options.projectNumber,
        filter,
        onProgress: (count) => {
          process.stderr.write(chalk.dim(`\rFetched ${count} items...`));
        },
      });
      logInfo(''); // Newline after progress

      logInfo(chalk.green(`Fetched ${items.length} items. Filtering...`));

      const processedItems: ProcessedIssue[] = items
        .map((item) => processItem(item, toDate))
        .filter((item) => {
          // Filter by update time falling within range?
          // "items from previous week" usually means created/updated/active.
          const updated = dayjs(item.updatedAt);
          return updated.isAfter(fromDate) && updated.isBefore(toDate);
        });

      logInfo(
        chalk.bold(`\nFound ${processedItems.length} items/issues active in the specified range`)
      );

      const activities: UserActivity[] = [];

      for (const item of processedItems) {
        // Find history events within date range
        const validHistory = item.history.filter((event) => {
          const eventTime = dayjs(event.when);
          return eventTime.isAfter(fromDate) && eventTime.isBefore(toDate);
        });

        for (const event of validHistory) {
          let type: ActivityType = 'unknown';
          if (event.type === 'status') type = 'issue_status_change';
          else if (event.type === 'label') type = 'issue_labeling';
          else if (event.type === 'state_change') type = 'issue_state_change';
          else if (event.type === 'assignment') type = 'issue_assignment';

          activities.push({
            type,
            author: event.who,
            date: event.when,
            repository: `${options.owner}/Project-${options.projectNumber}`, // Best guess for Project items
            title: item.title,
            url: item.url,
            description: `${event.action} ${event.value || ''}`.trim(),
            meta: {
              issueNumber: item.number,
              action: event.action,
              value: event.value,
              durationMs: event.durationMs,
            },
          });
        }
      }

      // Sort by date
      activities.sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

      console.log(JSON.stringify(activities, null, 2));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red('Error execution failed:'), errorMessage);
      process.exit(1);
    }
  });

function processItem(item: ProjectV2Item, reportToDate: dayjs.Dayjs = dayjs()): ProcessedIssue {
  const content = item.content;
  const isIssue = content.__typename === 'Issue';

  // Extract Status
  const statusField = item.fieldValues.nodes.find((n) => n.field?.name === 'Status');
  const status = statusField?.name || 'No Status';

  const history: IssueHistoryItem[] = [];

  if (isIssue && content.timelineItems?.nodes) {
    const events = content.timelineItems.nodes;
    for (const event of events) {
      const baseEvent = {
        when: event.createdAt,
        who: event.actor?.login || 'Unknown',
      };

      if (event.__typename === 'MovedColumnsInProjectEvent') {
        history.push({
          type: 'status',
          action: 'changed status to',
          value: event.projectColumnName,
          ...baseEvent,
        });
      } else if (event.__typename === 'LabeledEvent') {
        history.push({
          type: 'label',
          action: 'added label',
          value: event.label?.name,
          ...baseEvent,
        });
      } else if (event.__typename === 'ClosedEvent') {
        history.push({
          type: 'state_change',
          action: 'closed',
          ...baseEvent,
        });
      } else if (event.__typename === 'ReopenedEvent') {
        history.push({
          type: 'state_change',
          action: 'reopened',
          ...baseEvent,
        });
      } else if (event.__typename === 'AssignedEvent') {
        history.push({
          type: 'assignment',
          action: 'assigned',
          value: event.assignee?.login,
          ...baseEvent,
        });
      } else if (event.__typename === 'UnassignedEvent') {
        history.push({
          type: 'assignment',
          action: 'unassigned',
          value: event.assignee?.login,
          ...baseEvent,
        });
      } else if (event.__typename === 'ProjectV2ItemStatusChangedEvent') {
        history.push({
          type: 'status',
          action: 'changed status',
          value: `${event.previousStatus} -> ${event.status}`,
          ...baseEvent,
        });
      }
    }
  }

  // Calculate status durations
  const statusDurations: StatusDuration[] = [];
  const statusHistory = history
    .filter((h) => h.type === 'status')
    .sort((a, b) => dayjs(a.when).diff(dayjs(b.when)));

  let lastTime = content.createdAt ? dayjs(content.createdAt) : dayjs(content.updatedAt);
  let currentStatus = 'Initial';

  // Try to find initial status if possible
  if (statusHistory.length > 0) {
    const firstEvent = statusHistory[0];
    // If it's a status change event, we might have previous status
    if (firstEvent.action === 'changed status' && firstEvent.value?.includes(' -> ')) {
      currentStatus = firstEvent.value.split(' -> ')[0];
    } else if (firstEvent.action === 'changed status to') {
      // We don't know what it was before, 'Initial' is fine
    }
  }

  statusHistory.forEach((event) => {
    const eventTime = dayjs(event.when);
    const durationMs = calculateWorkingTime(lastTime, eventTime);

    if (durationMs > 0) {
      const existing = statusDurations.find((sd) => sd.status === currentStatus);
      if (existing) {
        existing.durationMs += durationMs;
      } else {
        statusDurations.push({ status: currentStatus, durationMs });
      }
      event.durationMs = durationMs;
    }

    // Update current status for next period
    if (event.action === 'changed status' && event.value?.includes(' -> ')) {
      currentStatus = event.value.split(' -> ')[1];
    } else {
      currentStatus = event.value || currentStatus;
    }
    lastTime = eventTime;
  });

  // Add duration for current final status
  const finalDurationMs = calculateWorkingTime(lastTime, reportToDate);
  if (finalDurationMs > 0) {
    const existing = statusDurations.find((sd) => sd.status === currentStatus);
    if (existing) {
      existing.durationMs += finalDurationMs;
    } else {
      statusDurations.push({ status: currentStatus, durationMs: finalDurationMs });
    }
  }

  return {
    id: item.id,
    number: content.number || 0,
    title: content.title || 'Untitled',
    url: content.url || '',
    status,
    assignees: content.assignees?.nodes.map((n) => n.login) || [],
    labels: content.labels?.nodes.map((n) => n.name) || [],
    updatedAt: content.updatedAt || '',
    history,
    statusDurations,
  };
}
