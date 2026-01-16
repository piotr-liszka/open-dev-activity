import { ActivityConnector, type ConnectorConfig } from '../core/activity-connector.js';
import { GitHubClient } from '../github.js';
import type { PullRequestInfo, PullRequestNode, UserActivity } from '../types.js';
import dayjs from 'dayjs';
import { getGitHubToken } from '../auth.js';
import { processPR } from '../core/pr-processor.js';

/**
 * Connector for fetching PR activities from GitHub
 * Implements ActivityConnector interface following SOLID principles
 */
export class PRsConnector extends ActivityConnector {
  readonly name = 'prs';

  async fetch(config: ConnectorConfig): Promise<UserActivity[]> {
    const owner = (config.owner as string) || process.env.GITHUB_OWNER;
    const repo = (config.repo as string) || process.env.GITHUB_REPO;

    if (!owner || !repo) {
      throw new Error('Owner and repo are required for PRs connector');
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
      : dayjs().subtract(7, 'day');

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

    const rawPRs = await client.fetchPullRequests({
      owner,
      repo,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    });

    const processedPRs: PullRequestInfo[] = rawPRs
      .filter((pr: any) => {
        const created = dayjs(pr.createdAt);
        return created.isAfter(fromDate) && created.isBefore(toDate);
      })
      .map((pr: any) => processPR(pr, toDate));

    const activities: UserActivity[] = [];
    const repoName = `${owner}/${repo}`;

    for (const pr of processedPRs) {
      // PR Created Activity
      if (dayjs(pr.createdAt).isAfter(fromDate) && dayjs(pr.createdAt).isBefore(toDate)) {
        activities.push({
          type: 'pr_created',
          author: pr.author,
          date: pr.createdAt,
          repository: repoName,
          title: pr.title,
          url: pr.url,
          description: `Created PR #${pr.number}`,
          meta: {
            prNumber: pr.number,
            changedFiles: pr.changedFiles,
            lifetimeMs: pr.lifetimeMs,
          },
        });
      }

      // Comments
      for (const comment of pr.comments) {
        if (dayjs(comment.when).isAfter(fromDate) && dayjs(comment.when).isBefore(toDate)) {
          activities.push({
            type: 'pr_comment',
            author: comment.who,
            date: comment.when,
            repository: repoName,
            title: pr.title,
            url: pr.url,
            description: comment.text,
            meta: {
              prNumber: pr.number,
              commentId: `${pr.number}-${comment.when}`, // Simple unique ID for comment
            },
          });
        }
      }

      // Reviews
      for (const review of pr.reviews) {
        if (dayjs(review.when).isAfter(fromDate) && dayjs(review.when).isBefore(toDate)) {
          activities.push({
            type: 'pr_review',
            author: review.who,
            date: review.when,
            repository: repoName,
            title: pr.title,
            url: pr.url,
            description: review.body || review.state,
            meta: {
              prNumber: pr.number,
              state: review.state,
              reviewId: `${pr.number}-${review.who}-${review.when}`, // Unique ID for review
            },
          });
        }
      }
    }

    // Sort activities
    activities.sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

    return activities;
  }

  /**
   * Override to use PR number and action type as unique identifier
   */
  generateActivityKey(activity: UserActivity): string {
    const prNumber = activity.meta?.prNumber;
    const actionId = activity.meta?.commentId || activity.meta?.reviewId || 'created';
    const dateStr = dayjs(activity.date).format('YYYY-MM-DD HH:mm');
    return `${activity.type}:${activity.author}:${dateStr}:${activity.repository}:${prNumber}:${actionId}`;
  }
}
