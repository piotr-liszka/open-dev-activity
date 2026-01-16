/**
 * Connector configuration
 * This file contains all connector-specific settings
 * Can be overridden by environment variables
 */

export interface ConnectorsConfig {
  issues?: {
    enabled: boolean;
    owner?: string;
    projectNumber?: number;
  };
  prs?: {
    enabled: boolean;
    owner?: string;
    repo?: string;
  };
  commits?: {
    enabled: boolean;
    repoDirectory?: string;
  };
}

/**
 * Load connector configuration from environment variables and defaults
 */
export function loadConnectorsConfig(): ConnectorsConfig {
  return {
    issues: {
      enabled: process.env.ISSUES_ENABLED !== 'false',
      owner: process.env.GITHUB_OWNER,
      projectNumber: process.env.PROJECT_NUMBER
        ? parseInt(process.env.PROJECT_NUMBER, 10)
        : undefined,
    },
    prs: {
      enabled: process.env.PRS_ENABLED !== 'false',
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
    },
    commits: {
      enabled: process.env.COMMITS_ENABLED !== 'false',
      repoDirectory: process.env.REPO_DIRECTORY,
    },
  };
}

/**
 * Get enabled connector names from config
 */
export function getEnabledConnectors(config: ConnectorsConfig): string[] {
  const enabled: string[] = [];
  if (config.issues?.enabled) enabled.push('issues');
  if (config.prs?.enabled) enabled.push('prs');
  if (config.commits?.enabled) enabled.push('commits');
  return enabled;
}

/**
 * Filter config to only include specified connectors
 */
export function filterConfigByConnectors(
  config: ConnectorsConfig,
  enabledConnectors: string[]
): ConnectorsConfig {
  const filtered: ConnectorsConfig = {};

  if (enabledConnectors.includes('issues') && config.issues) {
    filtered.issues = config.issues;
  } else if (config.issues) {
    filtered.issues = { ...config.issues, enabled: false };
  }

  if (enabledConnectors.includes('prs') && config.prs) {
    filtered.prs = config.prs;
  } else if (config.prs) {
    filtered.prs = { ...config.prs, enabled: false };
  }

  if (enabledConnectors.includes('commits') && config.commits) {
    filtered.commits = config.commits;
  } else if (config.commits) {
    filtered.commits = { ...config.commits, enabled: false };
  }

  return filtered;
}
