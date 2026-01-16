import { ActivityConnector, type ConnectorConfig } from '../core/activity-connector.js';
import type { UserActivity } from '../types.js';
import dayjs from 'dayjs';
import type { SimpleGit, LogResult, DiffResult } from 'simple-git';
import { simpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';

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
  remoteName?: string;
}

/**
 * Connector for fetching commit activities from local git repositories
 * Implements ActivityConnector interface following SOLID principles
 *
 * Note: This uses local git repos. For GitHub API commits, see GitHubCommitsConnector
 */
export class CommitsConnector extends ActivityConnector {
  readonly name = 'commits';

  async fetch(config: ConnectorConfig): Promise<UserActivity[]> {
    const repoDirectory = (config.repoDirectory as string) || process.env.REPO_DIRECTORY;

    if (!repoDirectory) {
      throw new Error('Repository directory is required for commits connector');
    }

    // Parse dates
    let fromDate: dayjs.Dayjs;

    const fromStr = typeof config.from === 'string' ? config.from : config.from?.toString();
    if (fromStr) {
      const daysAgoMatch = fromStr.match(/^(\d+)\s+days?\s+ago$/i);
      const hoursAgoMatch = fromStr.match(/^(\d+)\s+hours?\s+ago$/i);

      if (daysAgoMatch) {
        const days = parseInt(daysAgoMatch[1], 10);
        fromDate = dayjs().subtract(days, 'day');
      } else if (hoursAgoMatch) {
        const hours = parseInt(hoursAgoMatch[1], 10);
        fromDate = dayjs().subtract(hours, 'hour');
      } else {
        fromDate = dayjs(fromStr);
      }
    } else {
      fromDate = dayjs().subtract(7, 'day');
    }

    const toDate = config.to
      ? typeof config.to === 'string'
        ? dayjs(config.to)
        : config.to
      : dayjs();

    const repoDirectoryPath = path.resolve(repoDirectory);

    // Verify directory exists
    try {
      await fs.access(repoDirectoryPath);
    } catch {
      throw new Error(`Directory not found: ${repoDirectoryPath}`);
    }

    // Find all repositories (main + forks)
    const repositories = await this.findRepositories(repoDirectoryPath);

    if (repositories.length === 0) {
      throw new Error('No git repositories found in the specified directory');
    }

    // Fetch remotes for all repositories
    for (const repo of repositories) {
      await this.fetchRemotes(repo);
    }

    // Analyze commits from all repositories
    const allCommits: CommitAnalysis[] = [];

    for (const repo of repositories) {
      const commits = await this.analyzeRepository(repo, fromDate, toDate);
      allCommits.push(...commits);
    }

    // Sort commits by date
    allCommits.sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));

    // Map to UserActivity
    const activities: UserActivity[] = allCommits.map((commit) => ({
      type: 'commit',
      author: commit.author,
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

    return activities;
  }

  /**
   * Override to use commit hash as unique identifier
   */
  generateActivityKey(activity: UserActivity): string {
    const hash = activity.meta?.hash as string;
    if (!hash) {
      return super.generateActivityKey(activity);
    }
    return `${activity.type}:${activity.repository}:${hash}`;
  }

  private async findRepositories(baseDirectory: string): Promise<RepositoryInfo[]> {
    const repositories: RepositoryInfo[] = [];
    let masterRepo: RepositoryInfo | null = null;

    // Check if the base directory itself is a git repository
    const git = simpleGit(baseDirectory);
    const isRepo = await git.checkIsRepo();

    if (isRepo) {
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find((r) => r.name === 'origin');
      const remoteUrl = originRemote?.refs?.fetch || originRemote?.refs?.push;

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
          const gitPath = path.join(subPath, '.git');
          let hasOwnGit = false;

          try {
            const gitStat = await fs.stat(gitPath);
            hasOwnGit = gitStat.isDirectory() || gitStat.isFile();
          } catch {
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
                const isFork = remotes.length > 0 && remotes.some((r) => r.name !== 'origin');

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

  private async analyzeRepository(
    repo: RepositoryInfo,
    fromDate: dayjs.Dayjs,
    toDate: dayjs.Dayjs
  ): Promise<CommitAnalysis[]> {
    const git: SimpleGit = simpleGit(repo.path);
    const commits: CommitAnalysis[] = [];

    try {
      const logOptions: {
        '--since': string;
        '--until': string;
        '--remotes'?: string;
      } = {
        '--since': fromDate.format('YYYY-MM-DD'),
        '--until': toDate.format('YYYY-MM-DD'),
      };

      if (repo.isFork && repo.remoteName) {
        logOptions['--remotes'] = `${repo.remoteName}/*`;
      } else {
        logOptions['--remotes'] = `${repo.remoteName || 'origin'}/*`;
      }

      const log: LogResult = await git.log(logOptions);

      for (const commit of log.all) {
        const commitDate = dayjs(commit.date);

        if (
          (commitDate.isAfter(fromDate) || commitDate.isSame(fromDate)) &&
          (commitDate.isBefore(toDate) || commitDate.isSame(toDate))
        ) {
          let linesAdded = 0;
          let linesRemoved = 0;

          try {
            const diffResult: DiffResult = await git.diffSummary([`${commit.hash}^`, commit.hash]);
            linesAdded = diffResult.insertions || 0;
            linesRemoved = diffResult.deletions || 0;
          } catch {
            try {
              const diffResult: DiffResult = await git.diffSummary([commit.hash]);
              linesAdded = diffResult.insertions || 0;
              linesRemoved = diffResult.deletions || 0;
            } catch {
              // If still fails, leave as 0
            }
          }

          const existing = commits.find((c) => c.hash === commit.hash);
          if (!existing) {
            let sourceBranch = 'unknown';
            try {
              const branchesWithCommit = await git.raw(['branch', '-r', '--contains', commit.hash]);
              const branchList = branchesWithCommit
                .split('\n')
                .map((b) => b.trim().replace('* ', ''))
                .filter((b) => b);

              if (branchList.length > 0) {
                const remoteName = repo.remoteName || 'origin';
                const ownRemoteBranches = branchList.filter((b) => b.startsWith(`${remoteName}/`));
                if (ownRemoteBranches.length > 0) {
                  sourceBranch = ownRemoteBranches[0];
                } else {
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
      // Could not fully analyze repository
    }

    return commits;
  }

  private async fetchRemotes(repo: RepositoryInfo): Promise<void> {
    const git = simpleGit(repo.path);
    try {
      await git.fetch(['--all', '--tags', '--prune']);
    } catch {
      // Failed to fetch remotes
    }
  }
}
