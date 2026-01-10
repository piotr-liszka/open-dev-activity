import { Command } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';
import type { SimpleGit, LogResult, DiffResult } from 'simple-git';
import { simpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { confirm } from '@inquirer/prompts';

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
  .requiredOption('--repo-directory <string>', 'Path to the repository directory')
  .option('--from <date>', 'Start date to analyze commits (YYYY-MM-DD)', '7 days ago')
  .option('--to <date>', 'End date to analyze commits (YYYY-MM-DD)', 'now')
  .option('--non-interactive', 'Run in non-interactive mode (skip confirmation prompt)', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('Starting repository analysis...'));

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

      console.log(
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

      console.log(chalk.gray(`Repository Directory: ${repoDirectory}\n`));

      // Find all repositories (main + forks)
      const repositories = await findRepositories(repoDirectory);

      if (repositories.length === 0) {
        console.error(chalk.red('No git repositories found in the specified directory'));
        process.exit(1);
      }

      console.log(
        chalk.green(
          `Found ${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'}:`
        )
      );
      repositories.forEach((repo) => {
        const forkLabel = repo.isFork ? chalk.yellow(' (fork)') : chalk.cyan(' (master)');
        console.log(`  ${chalk.white(repo.name)}${forkLabel}`);
        if (repo.remoteUrl) {
          console.log(chalk.gray(`    Remote: ${repo.remoteUrl}`));
        }
      });
      console.log('');

      // Ask for confirmation before proceeding (unless in non-interactive mode)
      if (!options.nonInteractive) {
        const confirmed = await confirm({
          message: 'Do you want to proceed with analyzing these repositories?',
          default: true,
        });

        if (!confirmed) {
          console.log(chalk.yellow('Analysis cancelled by user.'));
          process.exit(0);
        }
      } else {
        console.log(chalk.gray('Running in non-interactive mode, proceeding with analysis...'));
      }

      console.log('');

      // Fetch remotes for all repositories
      console.log(chalk.blue('Fetching remotes...'));
      for (const repo of repositories) {
        await fetchRemotes(repo);
      }
      console.log(chalk.gray('Remotes fetched\n'));

      // Analyze commits from all repositories
      const allCommits: CommitAnalysis[] = [];

      for (const repo of repositories) {
        console.log(chalk.blue(`Analyzing ${repo.name}...`));
        const commits = await analyzeRepository(repo, fromDate, toDate);
        allCommits.push(...commits);
        console.log(chalk.gray(`  Found ${commits.length} commits\n`));
      }

      if (allCommits.length === 0) {
        console.log(chalk.yellow('No commits found in the specified date range.'));
        return;
      }

      // Sort commits by date (oldest first, newest at the end)
      allCommits.sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

      // Print report
      console.log(chalk.bold.green(`\n${'='.repeat(80)}`));
      console.log(chalk.bold.green(`COMMIT ANALYSIS REPORT`));
      console.log(chalk.bold.green(`Total Commits: ${allCommits.length}`));
      console.log(chalk.bold.green(`${'='.repeat(80)}\n`));

      allCommits.forEach((commit, index) => {
        console.log(chalk.cyan(`[${index + 1}] ${commit.hash.substring(0, 7)}`));
        console.log(chalk.white.bold(`  Message: ${commit.message.split('\n')[0]}`));
        console.log(chalk.gray(`  Author: ${commit.author} <${commit.email}>`));
        console.log(chalk.gray(`  Date: ${dayjs(commit.date).format('YYYY-MM-DD HH:mm:ss')}`));
        console.log(chalk.gray(`  Repository: ${commit.repository}`));

        const repoType = commit.isFork ? chalk.yellow('Fork') : chalk.cyan('Master Repository');
        console.log(chalk.gray(`  Repository Type: ${repoType}`));

        console.log(chalk.gray(`  Source Branch: ${commit.sourceBranch}`));

        const addedColor = commit.linesAdded > 0 ? chalk.green : chalk.gray;
        const removedColor = commit.linesRemoved > 0 ? chalk.red : chalk.gray;
        console.log(
          chalk.gray(`  Changes: `) +
            addedColor(`+${commit.linesAdded}`) +
            chalk.gray(' / ') +
            removedColor(`-${commit.linesRemoved}`)
        );
        console.log('');
      });

      // Summary statistics
      console.log(chalk.bold.blue(`\n${'='.repeat(80)}`));
      console.log(chalk.bold.blue(`SUMMARY STATISTICS`));
      console.log(chalk.bold.blue(`${'='.repeat(80)}\n`));

      const totalLinesAdded = allCommits.reduce((sum, c) => sum + c.linesAdded, 0);
      const totalLinesRemoved = allCommits.reduce((sum, c) => sum + c.linesRemoved, 0);
      const masterCommits = allCommits.filter((c) => !c.isFork);
      const forkCommits = allCommits.filter((c) => c.isFork);

      const authorStats = allCommits.reduce(
        (acc, commit) => {
          if (!acc[commit.author]) {
            acc[commit.author] = {
              commits: 0,
              linesAdded: 0,
              linesRemoved: 0,
            };
          }
          acc[commit.author].commits++;
          acc[commit.author].linesAdded += commit.linesAdded;
          acc[commit.author].linesRemoved += commit.linesRemoved;
          return acc;
        },
        {} as Record<string, { commits: number; linesAdded: number; linesRemoved: number }>
      );

      console.log(chalk.white(`Total Commits: ${chalk.bold(allCommits.length.toString())}`));
      console.log(
        chalk.white(`  Master Repository: ${chalk.cyan(masterCommits.length.toString())}`)
      );
      console.log(chalk.white(`  Forks: ${chalk.yellow(forkCommits.length.toString())}`));
      console.log(
        chalk.white(`Total Lines Added: ${chalk.green(`+${totalLinesAdded.toString()}`)}`)
      );
      console.log(
        chalk.white(`Total Lines Removed: ${chalk.red(`-${totalLinesRemoved.toString()}`)}`)
      );
      console.log(
        chalk.white(
          `Net Change: ${totalLinesAdded - totalLinesRemoved >= 0 ? chalk.green('+') : chalk.red('')}${(totalLinesAdded - totalLinesRemoved).toString()}`
        )
      );

      console.log(chalk.white.bold(`\nCommits by Author:`));
      Object.entries(authorStats)
        .sort((a, b) => b[1].commits - a[1].commits)
        .forEach(([author, stats]) => {
          console.log(
            chalk.white(
              `  ${author}: ${chalk.bold(stats.commits.toString())} commit${stats.commits === 1 ? '' : 's'} ` +
                `(${chalk.green(`+${stats.linesAdded}`)} / ${chalk.red(`-${stats.linesRemoved}`)})`
            )
          );
        });

      console.log('');
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
  const commits: CommitAnalysis[]  = [];

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
          const diffResult: DiffResult = await git.diffSummary([
            `${commit.hash}^`,
            commit.hash,
          ]);

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
              const ownRemoteBranches = branchList.filter(b => b.startsWith(`${remoteName}/`));

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
    console.log(chalk.gray(`  Fetching ${repo.name}...`));
    // Fetch all remotes
    await git.fetch(['--all', '--tags', '--prune']);
  } catch (error) {
    console.warn(chalk.yellow(`  Warning: Failed to fetch remotes for ${repo.name}`));
  }
}
