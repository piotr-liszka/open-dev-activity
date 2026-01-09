import { Command } from 'commander';
import chalk from 'chalk';
import { GitHubClient } from '../github.js';
import { formatDate, getDuration, parseDateInput } from '../utils.js';
import { PullRequestInfo, ReviewInfo, CommentInfo } from '../types.js';
import dayjs from 'dayjs';
import { getGitHubToken } from '../auth.js';
import { calculateWorkingTime, formatWorkingDuration } from '../working-time.js';

export const fetchPRsCommand = new Command('fetch-prs')
    .description('Fetch and analyze pull requests from a GitHub repository')
    .requiredOption('--owner <string>', 'GitHub Organization or User')
    .requiredOption('--repo <string>', 'GitHub Repository Name')
    .option('--from <date>', 'Start date (YYYY-MM-DD)', '7 days ago')
    .option('--to <date>', 'End date (YYYY-MM-DD)', 'now')
    .action(async (options) => {
        try {
            const authResult = await getGitHubToken();
            if (!authResult) {
                console.error(chalk.red('Error: GITHUB_TOKEN or GitHub App credentials are required.'));
                process.exit(1);
            }
            const { token, method } = authResult;

            const client = new GitHubClient(token);
            const whoami = await client.getAuthenticatedUser();

            console.log(chalk.gray(`Authenticated as: `) + chalk.whiteBright.bold(whoami) + chalk.gray(` (via ${method})`));
            console.log(chalk.blue(`Fetching PRs for ${options.owner}/${options.repo}...`));

            // Parse dates
            let fromDate = dayjs(options.from);
            if (options.from === '24 hours ago') {
                fromDate = dayjs().subtract(24, 'hour');
            } else if (options.from === '7 days ago') {
                fromDate = dayjs().subtract(7, 'day');
            }
            const toDate = options.to === 'now' ? dayjs() : dayjs(options.to);

            console.log(chalk.gray(`Time Range: ${fromDate.format('YYYY-MM-DD HH:mm')} to ${toDate.format('YYYY-MM-DD HH:mm')}`));

            const rawPRs = await client.fetchPullRequests({
                owner: options.owner,
                repo: options.repo,
                from: fromDate.toISOString(),
                to: toDate.toISOString(),
                onProgress: (count) => {
                    process.stdout.write(chalk.dim(`\rFetched ${count} PRs...`));
                }
            });
            console.log(''); // Newline after progress

            const processedPRs: PullRequestInfo[] = rawPRs
                .filter(pr => {
                    const created = dayjs(pr.createdAt);
                    return created.isAfter(fromDate) && created.isBefore(toDate);
                })
                .map(pr => processPR(pr, toDate));

            console.log(chalk.bold(`\nFound ${processedPRs.length} PRs in the specified range:\n`));

            processedPRs.forEach(pr => {
                console.log(chalk.cyan(`#${pr.number} ${pr.title}`));
                console.log(chalk.gray(`  Link: ${pr.url}`));
                console.log(chalk.gray(`  Created: ${formatDate(pr.createdAt)}`));
                console.log(chalk.gray(`  Files Changed: ${pr.changedFiles}`));
                console.log(chalk.gray(`  Lifetime: ${formatWorkingDuration(pr.lifetimeMs)} (working time)`));

                if (pr.isRequestChanges && pr.requestedChangesBy) {
                    console.log(chalk.red(`  MARKED AS "REQUEST CHANGES":`));
                    console.log(chalk.red(`    By: ${pr.requestedChangesBy.who}`));
                    console.log(chalk.red(`    When: ${formatDate(pr.requestedChangesBy.when)}`));
                } else {
                    console.log(chalk.green(`  Status: No "Request Changes" active`));
                }

                const totalDiscussions = pr.comments.length + pr.reviews.filter(r => r.body).length;
                if (totalDiscussions > 0) {
                    console.log(chalk.yellow(`  Discussion Details (${totalDiscussions} items):`));

                    // Combine and sort comments/reviews by date
                    const discussion = [
                        ...pr.comments.map(c => ({ ...c, type: 'Comment' })),
                        ...pr.reviews.filter(r => r.body).map(r => ({ who: r.who, when: r.when, text: r.body, type: `Review (${r.state})` }))
                    ].sort((a, b) => dayjs(a.when).diff(dayjs(b.when)));

                    discussion.forEach(item => {
                        console.log(`    ${chalk.gray(formatDate(item.when))} - ${chalk.blue(item.who)} [${item.type}]:`);
                        const indentedText = item.text.split('\n').map(line => `      ${line}`).join('\n');
                        console.log(chalk.white(indentedText));
                    });
                } else {
                    console.log(chalk.gray(`  No discussion details found.`));
                }
                console.log('');
            });

        } catch (error: any) {
            console.error(chalk.red('Error execution failed:'), error.message);
            process.exit(1);
        }
    });

function processPR(pr: any, reportToDate: dayjs.Dayjs): PullRequestInfo {
    const createdAt = pr.createdAt;
    const closedAt = pr.closedAt;
    const endForLifetime = closedAt ? dayjs(closedAt) : reportToDate;
    const lifetimeMs = calculateWorkingTime(createdAt, endForLifetime);

    const comments: CommentInfo[] = [];

    // Regular comments
    if (pr.comments?.nodes) {
        pr.comments.nodes.forEach((c: any) => {
            if (c.body) {
                comments.push({
                    who: c.author?.login || 'Unknown',
                    when: c.createdAt,
                    text: c.body
                });
            }
        });
    }

    // Review thread comments
    if (pr.reviewThreads?.nodes) {
        pr.reviewThreads.nodes.forEach((thread: any) => {
            if (thread.comments?.nodes) {
                thread.comments.nodes.forEach((c: any) => {
                    if (c.body) {
                        comments.push({
                            who: c.author?.login || 'Unknown',
                            when: c.createdAt,
                            text: c.body
                        });
                    }
                });
            }
        });
    }

    const reviews: ReviewInfo[] = [];
    let isRequestChanges = false;
    let requestedChangesBy: { who: string, when: string } | undefined;

    if (pr.reviews?.nodes) {
        pr.reviews.nodes.forEach((r: any) => {
            reviews.push({
                who: r.author?.login || 'Unknown',
                when: r.createdAt,
                state: r.state,
                body: r.body || ''
            });

            if (r.state === 'CHANGES_REQUESTED') {
                isRequestChanges = true;
                // Keep track of the latest requester
                if (!requestedChangesBy || dayjs(r.createdAt).isAfter(dayjs(requestedChangesBy.when))) {
                    requestedChangesBy = {
                        who: r.author?.login || 'Unknown',
                        when: r.createdAt
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
        pr.reviews.nodes.forEach((r: any) => {
            const login = r.author?.login || 'Unknown';
            if (!latestReviewPerUser[login] || dayjs(r.createdAt).isAfter(dayjs(latestReviewPerUser[login].split('|')[1]))) {
                latestReviewPerUser[login] = `${r.state}|${r.createdAt}`;
            }
        });
    }

    isRequestChanges = Object.values(latestReviewPerUser).some(v => v.split('|')[0] === 'CHANGES_REQUESTED');
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
        reviews,
        comments,
        isRequestChanges,
        requestedChangesBy,
        lifetimeMs
    };
}
