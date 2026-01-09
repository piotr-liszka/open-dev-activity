import { Command } from 'commander';
import chalk from 'chalk';
import { GitHubClient } from '../github.js';
import { formatDate } from '../utils.js';
import dayjs from 'dayjs';
import { getGitHubToken } from '../auth.js';

interface RepositoryCommits {
    name: string;
    fullName: string;
    url: string;
    isFork: boolean;
    isPrivate: boolean;
    defaultBranch: string;
    commits: CommitInfo[];
}

interface CommitInfo {
    sha: string;
    message: string;
    author: string;
    date: string;
    url: string;
    repoName: string;
    additions: number;
    deletions: number;
    branches: string[]; // Branches where this commit appears
}

export const analyzeRepoCommand = new Command('analyze-repo')
    .description('Fetch recent commits from all repositories owned by a user/organization')
    .requiredOption('--owner <string>', 'GitHub Organization or User')
    .option('--commits <number>', 'Number of recent commits to fetch per repository', '10')
    .option('--from <date>', 'Start date to filter commits (YYYY-MM-DD or "7 days ago")', '7 days ago')
    .option('--include-forks <boolean>', 'Include forked repositories', true)
    .option('--include-merges', 'Include merge commits')
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
            console.log(chalk.blue(`Fetching repositories for: ${options.owner}...`));

            // Parse from date
            let fromDate = dayjs(options.from);
            if (options.from === '7 days ago') {
                fromDate = dayjs().subtract(7, 'day');
            } else if (options.from === '24 hours ago') {
                fromDate = dayjs().subtract(24, 'hour');
            } else if (options.from === '30 days ago') {
                fromDate = dayjs().subtract(30, 'day');
            }

            console.log(chalk.gray(`Filtering commits from: ${fromDate.format('YYYY-MM-DD HH:mm')}`));
            console.log('');

            const includeForks = options.includeForks === true || options.includeForks === 'true' || options.includeForks === undefined;
            const includeMerges = options.includeMerges || false;
            const commitCount = parseInt(options.commits);

            const repositories = await fetchAllRepositories(
                client,
                options.owner,
                commitCount,
                includeForks,
                fromDate,
                includeMerges
            );

            displayRepositoryCommits(repositories, options.owner, includeForks, fromDate);

        } catch (error: any) {
            console.error(chalk.red('Error execution failed:'), error.message);
            process.exit(1);
        }
    });

async function fetchAllRepositories(
    client: GitHubClient,
    owner: string,
    commitCount: number,
    includeForks: boolean,
    fromDate: dayjs.Dayjs,
    includeMerges: boolean
): Promise<RepositoryCommits[]> {
    const repositories: RepositoryCommits[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
        // First, fetch all repositories with branches and their last commit dates
        const repoQuery = `
            query($owner: String!, $cursor: String) {
                repositoryOwner(login: $owner) {
                    repositories(first: 100, after: $cursor, orderBy: {field: PUSHED_AT, direction: DESC}) {
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                        nodes {
                            name
                            nameWithOwner
                            url
                            isFork
                            isPrivate
                            refs(refPrefix: "refs/heads/", first: 100) {
                                nodes {
                                    name
                                    target {
                                        ... on Commit {
                                            oid
                                            committedDate
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        const result: any = await (client as any).graphqlWithAuth(repoQuery, {
            owner,
            cursor
        });

        if (!result.repositoryOwner) {
            throw new Error(`Owner "${owner}" not found. Please check the owner name.`);
        }

        const repoData = result.repositoryOwner.repositories;
        const allRepoNodes = [...repoData.nodes];

        console.log(chalk.gray(`Found ${repoData.nodes.length} repositories for owner "${owner}".`));

        // Log counts of detected forks in the initial fetch
        const detectedForks = repoData.nodes.filter((r: any) => r.isFork);
        if (detectedForks.length > 0) {
            console.log(chalk.gray(`  - Initial fetch contains ${detectedForks.length} forked repositories.`));
            if (detectedForks.length < 5) {
                detectedForks.forEach((f: any) => console.log(chalk.dim(`    * ${f.nameWithOwner}`)));
            }
        } else {
            console.log(chalk.yellow(`  - Warning: No forked repositories were found in the initial fetch for "${owner}".`));
        }

        if (includeForks) {
            for (const repo of repoData.nodes) {
                // Also fetch forks OF this repository (descendant forks)
                const forkQuery = `
                    query($owner: String!, $repo: String!) {
                        repository(owner: $owner, name: $repo) {
                            forks(first: 50, orderBy: {field: PUSHED_AT, direction: DESC}) {
                                nodes {
                                    name
                                    nameWithOwner
                                    url
                                    isFork
                                    isPrivate
                                    refs(refPrefix: "refs/heads/", first: 100) {
                                        nodes {
                                            name
                                            target {
                                                ... on Commit {
                                                    oid
                                                    committedDate
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                try {
                    const forkResult: any = await (client as any).graphqlWithAuth(forkQuery, {
                        owner,
                        repo: repo.name
                    });

                    const forks = forkResult?.repository?.forks?.nodes || [];
                    if (forks.length > 0) {
                        console.log(chalk.gray(`  - Found ${forks.length} forks for ${repo.nameWithOwner}`));
                        allRepoNodes.push(...forks);
                    }
                } catch (error) {
                    // console.error(chalk.dim(`  Warning: Could not fetch forks for ${repo.nameWithOwner}`));
                }
            }
        }

        console.log(chalk.gray(`Processing ${allRepoNodes.length} candidate repositories (including descendant forks: ${allRepoNodes.length - repoData.nodes.length})...`));

        for (const repo of allRepoNodes) {
            // Log what we are checking if it's a fork
            if (repo.isFork) {
                process.stdout.write(chalk.dim(`\rChecking fork: ${repo.nameWithOwner}...`));
            } else {
                process.stdout.write(chalk.dim(`\rChecking repo: ${repo.nameWithOwner}...`));
            }

            // Skip forks if not included
            if (!includeForks && repo.isFork) {
                continue;
            }

            // Skip repositories without branches
            if (!repo.refs || !repo.refs.nodes || repo.refs.nodes.length === 0) {
                process.stdout.write(chalk.dim(`\n  Skipping ${repo.nameWithOwner}: No branches found.\n`));
                continue;
            }

            // Filter branches to only those updated within the date range
            const activeBranches = repo.refs.nodes.filter((branch: any) => {
                if (!branch.target || !branch.target.committedDate) return false;
                const branchDate = dayjs(branch.target.committedDate);
                return branchDate.isAfter(fromDate);
            });

            if (activeBranches.length === 0) {
                // Determine if it really has no recent activity across ALL branches
                const lastUpdated = repo.refs.nodes.length > 0 ? dayjs(repo.refs.nodes[0].target.committedDate).format('YYYY-MM-DD') : 'never';
                process.stdout.write(chalk.dim(`\n  Skipping ${repo.nameWithOwner}: No activity since ${fromDate.format('YYYY-MM-DD')}. (Last update: ${lastUpdated})\n`));
                continue;
            }

            // Track commits and which branches they appear in
            const commitToBranches = new Map<string, string[]>();
            const commitData = new Map<string, any>();

            for (const branch of activeBranches) {
                // Fetch commits for this branch
                const branchQuery = `
                    query($owner: String!, $repo: String!, $branch: String!, $commitCount: Int!, $since: GitTimestamp) {
                        repository(owner: $owner, name: $repo) {
                            ref(qualifiedName: $branch) {
                                target {
                                    ... on Commit {
                                        history(first: $commitCount, since: $since) {
                                            nodes {
                                                oid
                                                message
                                                author {
                                                    name
                                                    user {
                                                        login
                                                    }
                                                }
                                                committedDate
                                                url
                                                additions
                                                deletions
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                try {
                    const [repoOwner, repoName] = repo.nameWithOwner.split('/');
                    const branchResult: any = await (client as any).graphqlWithAuth(branchQuery, {
                        owner: repoOwner,
                        repo: repoName,
                        branch: `refs/heads/${branch.name}`,
                        commitCount,
                        since: fromDate.toISOString()
                    });

                    const commits = branchResult?.repository?.ref?.target?.history?.nodes || [];

                    for (const commit of commits) {
                        // Filter by date
                        const commitDate = dayjs(commit.committedDate);
                        if (commitDate.isBefore(fromDate)) {
                            continue;
                        }

                        // Filter merge commits if not included
                        if (!includeMerges) {
                            const message = commit.message.toLowerCase();
                            if (message.startsWith('merge pull request') ||
                                message.startsWith('merge branch') ||
                                message.startsWith('merge tag') ||
                                message.match(/^merge .+ into .+/)) {
                                continue;
                            }
                        }

                        // Track which branches this commit appears in
                        if (!commitToBranches.has(commit.oid)) {
                            commitToBranches.set(commit.oid, []);
                            commitData.set(commit.oid, commit);
                        }
                        commitToBranches.get(commit.oid)!.push(branch.name);
                    }
                } catch (error) {
                    // Skip branches that can't be accessed
                    console.error(chalk.dim(`  Warning: Could not fetch commits from ${repo.nameWithOwner}:${branch.name}`));
                }
            }

            // Build the final commit list with branch information
            const allCommits: CommitInfo[] = [];
            for (const [oid, branches] of commitToBranches.entries()) {
                const commit = commitData.get(oid);
                if (!commit) continue;

                allCommits.push({
                    sha: commit.oid.substring(0, 7),
                    message: commit.message.split('\n')[0],
                    author: commit.author?.user?.login || commit.author?.name || 'Unknown',
                    date: commit.committedDate,
                    url: commit.url,
                    repoName: repo.nameWithOwner,
                    additions: commit.additions || 0,
                    deletions: commit.deletions || 0,
                    branches: branches.sort() // Sort branch names alphabetically
                });
            }

            if (allCommits.length > 0) {
                repositories.push({
                    name: repo.name,
                    fullName: repo.nameWithOwner,
                    url: repo.url,
                    isFork: repo.isFork,
                    isPrivate: repo.isPrivate,
                    defaultBranch: '', // Not needed anymore
                    commits: allCommits
                });
            }
        }

        hasNextPage = repoData.pageInfo.hasNextPage;
        cursor = repoData.pageInfo.endCursor;

        // Progress indicator
        process.stdout.write(chalk.dim(`\rFetched ${repositories.length} repositories...`));
    }

    console.log(''); // Newline after progress
    return repositories;
}

function displayRepositoryCommits(
    repositories: RepositoryCommits[],
    owner: string,
    includeForks: boolean,
    fromDate: dayjs.Dayjs
): void {
    console.log(chalk.bold.cyan('═'.repeat(80)));
    console.log(chalk.bold.cyan(`  RECENT COMMITS FOR: ${owner}`));
    console.log(chalk.bold.cyan('═'.repeat(80)));
    console.log('');

    // Collect all commits and sort by date (latest first)
    const allCommits: CommitInfo[] = [];
    repositories.forEach(repo => {
        allCommits.push(...repo.commits);
    });

    // Sort commits by date descending (latest first)
    allCommits.sort((a, b) => dayjs(b.date).diff(dayjs(a.date)));

    // Summary
    const totalCommits = allCommits.length;
    const forkCount = repositories.filter(r => r.isFork).length;
    const nonForkCount = repositories.length - forkCount;
    const totalAdditions = allCommits.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = allCommits.reduce((sum, c) => sum + c.deletions, 0);

    console.log(chalk.bold.yellow('📊 SUMMARY'));
    console.log(chalk.gray('─'.repeat(80)));
    console.log(`  ${chalk.bold('Active Repositories (with commits):')} ${repositories.length}`);
    console.log(`  ${chalk.bold('  - Non-Fork:')} ${nonForkCount}`);
    if (includeForks) {
        console.log(`  ${chalk.bold('  - Forked:')} ${forkCount}`);
    }
    console.log(`  ${chalk.bold('Total Commits:')} ${totalCommits}`);
    console.log(`  ${chalk.bold('Lines Added:')} ${chalk.green(`+${totalAdditions.toLocaleString()}`)}`);
    console.log(`  ${chalk.bold('Lines Deleted:')} ${chalk.red(`-${totalDeletions.toLocaleString()}`)}`);
    console.log(`  ${chalk.bold('Net Change:')} ${(totalAdditions - totalDeletions).toLocaleString()}`);
    console.log(`  ${chalk.bold('Since:')} ${fromDate.format('YYYY-MM-DD HH:mm')}`);
    console.log('');

    if (allCommits.length === 0) {
        console.log(chalk.yellow('No commits found matching the criteria.'));
        console.log(chalk.bold.cyan('═'.repeat(80)));
        return;
    }

    // Display all commits sorted by date
    console.log(chalk.bold.yellow('📝 COMMITS (SORTED BY DATE - LATEST FIRST)'));
    console.log(chalk.gray('─'.repeat(80)));
    console.log('');

    allCommits.forEach((commit, index) => {
        const commitNumber = `${index + 1}.`.padStart(4);
        const diffStats = `${chalk.green(`+${commit.additions}`)} ${chalk.red(`-${commit.deletions}`)}`;
        const branchInfo = commit.branches.length > 0
            ? chalk.dim(`[${commit.branches.join(', ')}]`)
            : '';

        console.log(`${chalk.gray(commitNumber)} ${chalk.yellow(commit.sha)} ${chalk.blue(commit.author)} ${diffStats} ${branchInfo}`);
        console.log(`     ${chalk.cyan(commit.repoName)}`);
        console.log(`     ${commit.message}`);
        console.log(`     ${chalk.dim(formatDate(commit.date))}`);

        if (index < allCommits.length - 1) {
            console.log('');
        }
    });

    console.log('');
    console.log(chalk.bold.cyan('═'.repeat(80)));
    console.log(chalk.green('✓ Fetch complete!'));
    console.log(chalk.bold.cyan('═'.repeat(80)));
}
