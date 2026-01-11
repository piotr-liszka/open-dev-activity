import { Command } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';
import type { SimpleGit, LogResult, DiffResult } from 'simple-git';
import { simpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { confirm } from '@inquirer/prompts';
import type { UserActivity } from '../types.js';
import { logInfo } from '../logger.js';

interface CommitAnalysis {
  author: string;
  email: string;
  date: string;
  hash: string;
  message: string;
  isFork: boolean;
  sourceBranch: string;
  linesAdded: number;
  linesRemoved: number;
  repository: string;
}

interface RepositoryInfo {
  name: string;
  path: string;
  isFork: boolean;
  remoteUrl?: string;
  remoteName?: string; // The git remote name (e.g., 'origin', 'upstream', etc.)
}

export const analyseReposCommand = new Command('analyse-repos')
  .description('Analyze commits from a repository and all its forks')
  .option(
    '--repo-directory <string>',
    'Path to the repository directory',
    process.env.REPO_DIRECTORY
  )
  .option(
    '--from <date>',
    'Start date to analyze commits (YYYY-MM-DD)',
    process.env.DATE_FROM || '7 days ago'
  )
  .option('--to <date>', 'End date to analyze commits (YYYY-MM-DD)', process.env.DATE_TO || 'now')
  .option('--non-interactive', 'Run in non-interactive mode (skip confirmation prompt)', false)
  .action(async (options) => {
    try {
      if (!options.repoDirectory) {
        console.error(
          chalk.red(
            'Error: Repository directory is required. Provide via --repo-directory or REPO_DIRECTORY env var.'
          )
        );
        process.exit(1);
      }
      logInfo(chalk.blue('Starting repository analysis...'));

      // Parse dates
      let fromDate: dayjs.Dayjs;

      // Handle relative date formats
      const daysAgoMatch = options.from.match(/^(\d+)\s+days?\s+ago$/i);
      const hoursAgoMatch = options.from.match(/^(\d+)\s+hours?\s+ago$/i);

      if (daysAgoMatch) {
        const days = parseInt(daysAgoMatch[1], 10);
        fromDate = dayjs().subtract(days, 'day');
      } else if (hoursAgoMatch) {
        const hours = parseInt(hoursAgoMatch[1], 10);
        fromDate = dayjs().subtract(hours, 'hour');
      } else {
        fromDate = dayjs(options.from);
      }

      const toDate = options.to === 'now' ? dayjs() : dayjs(options.to);

      logInfo(
        chalk.gray(
          `Time Range: ${fromDate.format('YYYY-MM-DD HH:mm')} to ${toDate.format('YYYY-MM-DD HH:mm')}`
        )
      );

      const repoDirectory = path.resolve(options.repoDirectory);

      // Verify directory exists
      try {
        await fs.access(repoDirectory);
      } catch {
        console.error(chalk.red(`Error: Directory not found: ${repoDirectory}`));
        process.exit(1);
      }

      logInfo(chalk.gray(`Repository Directory: ${repoDirectory}\n`));

      // Find all repositories (main + forks)
      const repositories = await findRepositories(repoDirectory);

      if (repositories.length === 0) {
        console.error(chalk.red('No git repositories found in the specified directory'));
        process.exit(1);
      }

      logInfo(
        chalk.green(
          `Found ${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'}:`
        )
      );
      repositories.forEach((repo) => {
        const forkLabel = repo.isFork ? chalk.yellow(' (fork)') : chalk.cyan(' (master)');
        logInfo(`  ${chalk.white(repo.name)}${forkLabel}`);
        if (repo.remoteUrl) {
          logInfo(chalk.gray(`    Remote: ${repo.remoteUrl}`));
        }
      });
      logInfo('');

      // Ask for confirmation before proceeding (unless in non-interactive mode)
      if (!options.nonInteractive) {
        const confirmed = await confirm({
          message: 'Do you want to proceed with analyzing these repositories?',
          default: true,
        });

        if (!confirmed) {
          logInfo(chalk.yellow('Analysis cancelled by user.'));
          process.exit(0);
        }
      } else {
        logInfo(chalk.gray('Running in non-interactive mode, proceeding with analysis...'));
      }

      logInfo('');

      // Fetch remotes for all repositories
      logInfo(chalk.blue('Fetching remotes...'));
      for (const repo of repositories) {
        await fetchRemotes(repo);
      }
      logInfo(chalk.gray('Remotes fetched\n'));

      // Analyze commits from all repositories
      const allCommits: CommitAnalysis[] = [];

      for (const repo of repositories) {
        logInfo(chalk.blue(`Analyzing ${repo.name}...`));
        const commits = await analyzeRepository(repo, fromDate, toDate);
        allCommits.push(...commits);
        logInfo(chalk.gray(`  Found ${commits.length} commits\n`));
      }

      // Sort commits by date (oldest first, newest at the end)
      allCommits.sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

      // Map to UserActivity
      const activities: UserActivity[] = allCommits.map((commit) => ({
        type: 'commit',
        author: commit.author, // or commit.email if preferred as identifier, but type says author
        date: dayjs(commit.date).toISOString(),
        repository: commit.repository,
        title: commit.message.split('\n')[0],
        description: commit.message,
        meta: {
          hash: commit.hash,
          email: commit.email,
          isFork: commit.isFork,
          sourceBranch: commit.sourceBranch,
          linesAdded: commit.linesAdded,
          linesRemoved: commit.linesRemoved,
        },
      }));

      // Output JSON to stdout
      console.log(JSON.stringify(activities, null, 2));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red('Error execution failed:'), errorMessage);
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });

async function findRepositories(baseDirectory: string): Promise<RepositoryInfo[]> {
  const repositories: RepositoryInfo[] = [];
  let masterRepo: RepositoryInfo | null = null;

  // Check if the base directory itself is a git repository
  const git = simpleGit(baseDirectory);
  const isRepo = await git.checkIsRepo();

  if (isRepo) {
    const remotes = await git.getRemotes(true);
    const originRemote = remotes.find((r) => r.name === 'origin');
    const remoteUrl = originRemote?.refs?.fetch || originRemote?.refs?.push;

    // This is the master repository (has origin remote)
    masterRepo = {
      name: path.basename(baseDirectory),
      path: baseDirectory,
      isFork: false,
      remoteUrl,
      remoteName: 'origin',
    };
    repositories.push(masterRepo);

    // Check for additional remotes (forks) in the main repository
    const otherRemotes = remotes.filter((r) => r.name !== 'origin');

    for (const remote of otherRemotes) {
      const remoteUrl = remote.refs?.fetch || remote.refs?.push;
      repositories.push({
        name: `${path.basename(baseDirectory)} (${remote.name})`,
        path: baseDirectory,
        isFork: true,
        remoteUrl,
        remoteName: remote.name,
      });
    }
  }

  // Look for subdirectories that are git repositories (potential forks)
  try {
    const entries = await fs.readdir(baseDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.git') {
        const subPath = path.join(baseDirectory, entry.name);

        // Check if this directory has its own .git folder (is a repo root)
        const gitPath = path.join(subPath, '.git');
        let hasOwnGit = false;
        try {
          const gitStat = await fs.stat(gitPath);
          hasOwnGit = gitStat.isDirectory() || gitStat.isFile(); // Can be directory or file (for submodules)
        } catch {
          // No .git folder/file, not a repo root
          hasOwnGit = false;
        }

        if (hasOwnGit) {
          const subGit = simpleGit(subPath);

          try {
            const isSubRepo = await subGit.checkIsRepo();

            if (isSubRepo) {
              const remotes = await subGit.getRemotes(true);
              const originRemote = remotes.find((r) => r.name === 'origin');
              const remoteUrl = originRemote?.refs?.fetch || originRemote?.refs?.push;

              // Determine if this is a fork by checking if it has non-origin remotes
              // pointing to the master repository, or if it's just a subdirectory repo
              const isFork = remotes.length > 0 && remotes.some((r) => r.name !== 'origin');

              // If master repo exists, check if any remote points to it
              let isForkOfMaster = false;
              if (masterRepo && masterRepo.remoteUrl) {
                const masterUrl = masterRepo.remoteUrl;
                isForkOfMaster = remotes.some((r) => {
                  const url = r.refs?.fetch || r.refs?.push;
                  return url && url === masterUrl;
                });
              }

              repositories.push({
                name: entry.name,
                path: subPath,
                isFork: isFork || isForkOfMaster,
                remoteUrl,
                remoteName: 'origin',
              });
            }
          } catch {
            // Not a git repository, skip
          }
        }
      }
    }
  } catch {
    // Could not read directory, just use base if it's a repo
  }

  return repositories;
}

async function analyzeRepository(
  repo: RepositoryInfo,
  fromDate: dayjs.Dayjs,
  toDate: dayjs.Dayjs
): Promise<CommitAnalysis[]> {
  const git: SimpleGit = simpleGit(repo.path);
  const commits: CommitAnalysis[] = [];

  try {
    // Get log for all branches (or specific remote) within date range
    const logOptions: any = {
      '--since': fromDate.format('YYYY-MM-DD'),
      '--until': toDate.format('YYYY-MM-DD'),
    };

    if (repo.isFork && repo.remoteName) {
      // For forks, look at commits from the specific remote
      logOptions['--remotes'] = `${repo.remoteName}/*`;
    } else {
      // For main repo, look at commits from origin remote only (not fork remotes)
      logOptions['--remotes'] = `${repo.remoteName || 'origin'}/*`;
    }

    const log: LogResult = await git.log(logOptions);

    for (const commit of log.all) {
      const commitDate = dayjs(commit.date);

      // Double check date is in range (inclusive)
      if (
        (commitDate.isAfter(fromDate) || commitDate.isSame(fromDate)) &&
        (commitDate.isBefore(toDate) || commitDate.isSame(toDate))
      ) {
        // Get diff stats for this commit
        let linesAdded = 0;
        let linesRemoved = 0;

        try {
          const diffResult: DiffResult = await git.diffSummary([`${commit.hash}^`, commit.hash]);

          linesAdded = diffResult.insertions || 0;
          linesRemoved = diffResult.deletions || 0;
        } catch {
          // First commit might not have a parent, or other issues
          try {
            const diffResult: DiffResult = await git.diffSummary([commit.hash]);
            linesAdded = diffResult.insertions || 0;
            linesRemoved = diffResult.deletions || 0;
          } catch {
            // If still fails, leave as 0
          }
        }

        // Check if this commit already exists (same hash)
        const existing = commits.find((c) => c.hash === commit.hash);
        if (!existing) {
          // Find which branch contains this commit
          let sourceBranch = 'unknown';
          try {
            // Get all branches containing this commit
            const branchesWithCommit = await git.raw(['branch', '-r', '--contains', commit.hash]);
            const branchList = branchesWithCommit
              .split('\n')
              .map((b) => b.trim().replace('* ', ''))
              .filter((b) => b);

            if (branchList.length > 0) {
              // Filter to get branches from the repository's own remote
              const remoteName = repo.remoteName || 'origin';
              const ownRemoteBranches = branchList.filter((b) => b.startsWith(`${remoteName}/`));

              // Prioritize branches from the repository's own remote
              if (ownRemoteBranches.length > 0) {
                sourceBranch = ownRemoteBranches[0];
              } else {
                // Fallback to any branch if no own remote branches found
                sourceBranch = branchList[0];
              }
            }
          } catch {
            // Use unknown if we can't determine
          }

          commits.push({
            author: commit.author_name,
            email: commit.author_email,
            date: commit.date,
            hash: commit.hash,
            message: commit.message,
            isFork: repo.isFork,
            sourceBranch,
            linesAdded,
            linesRemoved,
            repository: repo.name,
          });
        }
      }
    }
  } catch {
    console.warn(chalk.yellow(`  Warning: Could not fully analyze ${repo.name}`));
  }

  return commits;
}

async function fetchRemotes(repo: RepositoryInfo): Promise<void> {
  const git: SimpleGit = simpleGit(repo.path);

  try {
    logInfo(chalk.gray(`  Fetching ${repo.name}...`));
    // Fetch all remotes
    await git.fetch(['--all', '--tags', '--prune']);
  } catch {
    console.warn(chalk.yellow(`  Warning: Failed to fetch remotes for ${repo.name}`));
  }
}
