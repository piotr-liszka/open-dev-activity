import { Command } from 'commander';
import chalk from 'chalk';
import { GitHubClient } from '../github.js';
import type {
  PullRequestInfo,
  ReviewInfo,
  CommentInfo,
  UserActivity,
  PullRequestNode,
} from '../types.js';
import dayjs from 'dayjs';
import { getGitHubToken } from '../auth.js';
import { calculateWorkingTime } from '../core/working-time.js';
import { logInfo } from '../logger.js';
import { emitActivities } from '../core/event-bus.js';

export const fetchPRsCommand = new Command('fetch-prs')
  .description('Fetch and analyze pull requests from a GitHub repository')
  .option('--owner <string>', 'GitHub Organization or User', process.env.GITHUB_OWNER)
  .option('--repo <string>', 'GitHub Repository Name', process.env.GITHUB_REPO)
  .option('--from <date>', 'Start date (YYYY-MM-DD)', process.env.DATE_FROM || '7 days ago')
  .option('--to <date>', 'End date (YYYY-MM-DD)', process.env.DATE_TO || 'now')
  .action(async (options) => {
    try {
      if (!options.owner) {
        console.error(
          chalk.red('Error: Owner is required. Provide via --owner or GITHUB_OWNER env var.')
        );
        process.exit(1);
      }
      if (!options.repo) {
        console.error(
          chalk.red('Error: Repository is required. Provide via --repo or GITHUB_REPO env var.')
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
      const whoami = await client.getAuthenticatedUser();

      logInfo(
        chalk.gray(`Authenticated as: `) +
          chalk.whiteBright.bold(whoami) +
          chalk.gray(` (via ${method})`)
      );
      logInfo(chalk.blue(`Fetching PRs for ${options.owner}/${options.repo}...`));

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

      const rawPRs = await client.fetchPullRequests({
        owner: options.owner,
        repo: options.repo,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        onProgress: (count) => {
          process.stderr.write(chalk.dim(`\rFetched ${count} PRs...`));
        },
      });
      logInfo(''); // Newline after progress

      const processedPRs: PullRequestInfo[] = rawPRs
        .filter((pr) => {
          const created = dayjs(pr.createdAt);
          return created.isAfter(fromDate) && created.isBefore(toDate);
        })
        .map((pr) => processPR(pr, toDate));

      logInfo(chalk.bold(`\nFound ${processedPRs.length} PRs in the specified range`));

      const activities: UserActivity[] = [];

      for (const pr of processedPRs) {
        const repoName = `${options.owner}/${options.repo}`;

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
              },
            });
          }
        }
      }

      // Sort activities
      activities.sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

      // Emit activities to event bus for persistence
      await emitActivities(activities);

      console.log(JSON.stringify(activities, null, 2));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red('Error execution failed:'), errorMessage);
      process.exit(1);
    }
  });

function processPR(pr: PullRequestNode, reportToDate: dayjs.Dayjs): PullRequestInfo {
  const createdAt = pr.createdAt;
  const closedAt = pr.closedAt;
  const endForLifetime = closedAt ? dayjs(closedAt) : reportToDate;
  const lifetimeMs = calculateWorkingTime(createdAt, endForLifetime);

  const comments: CommentInfo[] = [];

  // Regular comments
  if (pr.comments?.nodes) {
    pr.comments.nodes.forEach((c) => {
      if (c.body) {
        comments.push({
          who: c.author?.login || 'Unknown',
          when: c.createdAt,
          text: c.body,
        });
      }
    });
  }

  // Review thread comments
  if (pr.reviewThreads?.nodes) {
    pr.reviewThreads.nodes.forEach((thread) => {
      if (thread.comments?.nodes) {
        thread.comments.nodes.forEach((c) => {
          if (c.body) {
            comments.push({
              who: c.author?.login || 'Unknown',
              when: c.createdAt,
              text: c.body,
            });
          }
        });
      }
    });
  }

  const reviews: ReviewInfo[] = [];
  let isRequestChanges = false;
  let requestedChangesBy: { who: string; when: string } | undefined;

  if (pr.reviews?.nodes) {
    pr.reviews.nodes.forEach((r) => {
      reviews.push({
        who: r.author?.login || 'Unknown',
        when: r.createdAt,
        state: r.state,
        body: r.body || '',
      });

      if (r.state === 'CHANGES_REQUESTED') {
        isRequestChanges = true;
        // Keep track of the latest requester
        if (!requestedChangesBy || dayjs(r.createdAt).isAfter(dayjs(requestedChangesBy.when))) {
          requestedChangesBy = {
            who: r.author?.login || 'Unknown',
            when: r.createdAt,
          };
        }
      }
    });
  }

  // If there's a subsequent APPROVED review from the same person, we might want to clear isRequestChanges?
  // But the requirement says "is marked as 'request changes'". I'll stick to showing the latest requested changes.
  // Usually if a PR is approved later, it's not "currently" marked as request changes.
  // Let's refine: if the LATEST review from someone who requested changes is now APPROVED, then it's not requested changes.
  // Actually, GitHub works per-user. If ANY user has an active CHANGES_REQUESTED review, it's blocked.

  const latestReviewPerUser: Record<string, string> = {};
  if (pr.reviews?.nodes) {
    pr.reviews.nodes.forEach((r) => {
      const login = r.author?.login || 'Unknown';
      if (
        !latestReviewPerUser[login] ||
        dayjs(r.createdAt).isAfter(dayjs(latestReviewPerUser[login].split('|')[1]))
      ) {
        latestReviewPerUser[login] = `${r.state}|${r.createdAt}`;
      }
    });
  }

  isRequestChanges = Object.values(latestReviewPerUser).some(
    (v) => v.split('|')[0] === 'CHANGES_REQUESTED'
  );
  if (isRequestChanges) {
    // Find the latest one that is still in CHANGES_REQUESTED state
    let latestDate = dayjs(0);
    Object.entries(latestReviewPerUser).forEach(([user, value]) => {
      const [state, dateStr] = value.split('|');
      if (state === 'CHANGES_REQUESTED') {
        const date = dayjs(dateStr);
        if (date.isAfter(latestDate)) {
          latestDate = date;
          requestedChangesBy = { who: user, when: dateStr };
        }
      }
    });
  }

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    createdAt,
    closedAt,
    changedFiles: pr.changedFiles,
    author: pr.author?.login || 'Unknown',
    reviews,
    comments,
    isRequestChanges,
    requestedChangesBy,
    lifetimeMs,
  };
}
