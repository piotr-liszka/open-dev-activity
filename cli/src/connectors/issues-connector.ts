import { ActivityConnector, type ConnectorConfig } from '../core/activity-connector.js';
import { GitHubClient } from '../github.js';
import type { ProcessedIssue, ActivityType } from '../types.js';
import dayjs from 'dayjs';
import { getGitHubToken } from '../auth.js';
import { processItem } from '../core/issue-processor.js';

/**
 * Connector for fetching issue activities from GitHub ProjectV2
 * Implements ActivityConnector interface following SOLID principles
 */
export class IssuesConnector extends ActivityConnector {
  readonly name = 'issues';

  async fetch(config: ConnectorConfig): Promise<import('../types.js').UserActivity[]> {
    const owner = (config.owner as string) || process.env.GITHUB_OWNER;
    const projectNumber =
      (config.projectNumber as number) || parseInt(process.env.PROJECT_NUMBER || '0', 10);

    if (!owner || !projectNumber) {
      throw new Error('Owner and project number are required for issues connector');
    }

    const authResult = await getGitHubToken();
    if (!authResult) {
      throw new Error('GITHUB_TOKEN or GitHub App credentials are required');
    }

    const client = new GitHubClient(authResult.token);

    // Parse dates
    let fromDate = config.from
      ? typeof config.from === 'string'
        ? dayjs(config.from)
        : config.from
      : dayjs().subtract(24, 'hour');

    if (typeof config.from === 'string') {
      if (config.from === '24 hours ago') {
        fromDate = dayjs().subtract(24, 'hour');
      } else if (config.from === '7 days ago') {
        fromDate = dayjs().subtract(7, 'day');
      }
    }

    const toDate = config.to
      ? typeof config.to === 'string'
        ? dayjs(config.to)
        : config.to
      : dayjs();

    // Construct filter for GraphQL
    let filter = `updated:>=${fromDate.format('YYYY-MM-DD')}`;
    if (toDate && !dayjs.isDayjs(config.to) && config.to !== 'now') {
      filter = `updated:${fromDate.format('YYYY-MM-DD')}..${toDate.format('YYYY-MM-DD')}`;
    }

    const items = await client.fetchProjectItems({
      owner,
      projectNumber,
      filter,
    });

    const processedItems: ProcessedIssue[] = items
      .map((item) => processItem(item, toDate))
      .filter((item) => {
        const updated = dayjs(item.updatedAt);
        return updated.isAfter(fromDate) && updated.isBefore(toDate);
      });

    const activities: import('../types.js').UserActivity[] = [];

    for (const item of processedItems) {
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
          repository: `${owner}/Project-${projectNumber}`,
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

    return activities;
  }

  /**
   * Override to use issue number as unique identifier
   */
  generateActivityKey(activity: import('../types.js').UserActivity): string {
    const issueNumber = activity.meta?.issueNumber;
    const action = activity.meta?.action || 'unknown';
    const dateStr = dayjs(activity.date).format('YYYY-MM-DD HH:mm');
    return `${activity.type}:${activity.author}:${dateStr}:${activity.repository}:${issueNumber}:${action}`;
  }
}
