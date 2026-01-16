# AGENTS.md - Developer Activity Monitor Platform

This file contains instructions for AI coding agents working with the Developer Activity Monitor Platform. For general contributor guidelines, see README.md.

## Project Overview

The Developer Activity Monitor Platform is a TypeScript-based system that fetches, normalizes, and stores developer activity from multiple sources (GitHub Issues, PRs, Commits). The platform provides unified storage and querying capabilities to understand developer productivity and work patterns.

**Core Purpose:** Aggregate developer activities from GitHub (issues, PRs, commits) into a unified PostgreSQL database, then provide querying capabilities for analysis.

**Technology Stack:**
- TypeScript (strict mode, ES2020+)
- Node.js 18+
- Commander.js for CLI
- Drizzle ORM for database operations
- PostgreSQL (Neon serverless or local)
- dayjs for date handling
- chrono-node for natural language date parsing
- simple-git for local repository analysis
- chalk for colored output

## Architecture

### SOLID Principles

The project follows SOLID principles:

1. **Single Responsibility**: Each connector handles one data source (Issues, PRs, Commits)
2. **Open-Closed**: New connectors can be added by implementing `ActivityConnector` interface
3. **Liskov Substitution**: All connectors implement the same interface and are interchangeable
4. **Interface Segregation**: `ActivityConnector` interface is minimal and focused
5. **Dependency Inversion**: High-level services depend on abstractions, not concrete implementations

### Key Components

- **Connectors** (`src/connectors/`): Fetch activities from sources (Issues, PRs, Commits)
- **Activity Service** (`src/core/activity-service.ts`): Orchestrates saving activities
- **Activity Repository** (`src/infrastructure/activity-repository.ts`): Database operations with upsert logic
- **Schema** (`src/infrastructure/schema.ts`): Drizzle ORM table definitions

### Database Schema

The `activities` table stores all activity types:
- `id`: UUID primary key
- `unique_key`: VARCHAR(500) - Used for deduplication/upsert
- `type`: Activity type (commit, pr_created, pr_review, issue_status_change, etc.)
- `author`: Developer username
- `activity_date`: Timestamp of the activity
- `repository`: Repository identifier
- `url`, `title`, `description`: Activity details
- `meta`: JSONB for flexible metadata
- `created_at`, `updated_at`: Timestamps

## Dev Environment Setup

### Initial Setup

1. Install dependencies:
   ```bash
   cd cli
   pnpm install
   ```

2. Build the project:
   ```bash
   pnpm run build
   # or for watch mode during development
   pnpm run dev
   ```

3. Create environment configuration:
   ```bash
   cp .env.example .env
   # Edit .env with:
   # - GITHUB_TOKEN (or GitHub App credentials)
   # - DATABASE_URL (PostgreSQL connection string)
   # - GITHUB_OWNER, GITHUB_REPO, PROJECT_NUMBER (for connectors)
   # - REPO_DIRECTORY (for commits connector)
   ```

### Environment Variables

```bash
# Authentication
GITHUB_TOKEN=your_github_token
# Or GitHub App:
GITHUB_APP_ID=your_app_id
GITHUB_APP_INSTALLATION_ID=your_installation_id
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Connector Configuration
GITHUB_OWNER=your_org_or_user
GITHUB_REPO=your_repo_name
PROJECT_NUMBER=1
REPO_DIRECTORY=/path/to/repos

# Enable/Disable Connectors
ISSUES_ENABLED=true
PRS_ENABLED=true
COMMITS_ENABLED=true
```

## CLI Commands

### Run Commands

```bash
# Using pnpm
pnpm cli <command> [options]

# Or using tsx directly
npx tsx src/index.ts <command> [options]
```

### 1. sync-activities

Sync all developer activities from all sources. Designed for cron jobs.

```bash
pnpm cli sync-activities [options]
```

**Options:**
- `--from <date>` - Start date (default: "15 minutes ago")
    - Supports natural language: "15 minutes ago", "7 days ago", "24 hours ago"
    - Or YYYY-MM-DD format
- `--to <date>` - End date (default: "now")
- `--enabled-connectors <list>` - Comma-separated list: issues,prs,commits

**Examples:**
```bash
# Sync last 15 minutes (for cron)
pnpm cli sync-activities

# Sync specific date range
pnpm cli sync-activities --from "7 days ago" --to "now"

# Sync only commits
pnpm cli sync-activities --enabled-connectors commits

# Sync issues and PRs only
pnpm cli sync-activities --enabled-connectors issues,prs
```

**Cron setup:**
```bash
*/15 * * * * cd /path/to/cli && pnpm cli sync-activities --from "15 minutes ago" >> /var/log/activity-sync.log 2>&1
```

### 2. query-activities

Query stored activities from the database.

```bash
pnpm cli query-activities [options]
```

**Options:**
- `--author <string>` - Filter by author
- `--repository <string>` - Filter by repository
- `--type <string>` - Filter by activity type
- `--from <date>` - Start date (YYYY-MM-DD)
- `--to <date>` - End date (YYYY-MM-DD)
- `--limit <number>` - Maximum results (default: 100)
- `--offset <number>` - Skip first N results (default: 0)
- `--count-only` - Only show count
- `--format <string>` - Output format: json, table (default: json)

**Activity Types:**
- `commit` - Git commits
- `pr_created` - Pull request created
- `pr_review` - PR review submitted
- `pr_comment` - PR comment added
- `issue_status_change` - Issue status changed
- `issue_assignment` - Issue assigned/unassigned
- `issue_labeling` - Label added/removed
- `issue_state_change` - Issue opened/closed

**Examples:**
```bash
# Query all activities
pnpm cli query-activities

# Filter by author and type
pnpm cli query-activities --author "john@example.com" --type commit

# Table format output
pnpm cli query-activities --format table --limit 50

# Count only
pnpm cli query-activities --author "john@example.com" --count-only
```

## Code Style & Conventions

### TypeScript Standards

- **Strict mode enabled:** No `any` types without `// @ts-ignore` comment
- **Naming conventions:**
    - Types/Interfaces: PascalCase (`UserActivity`, `ConnectorConfig`)
    - Variables/functions: camelCase (`fetchUser`, `developerName`)
    - Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`, `BATCH_SIZE`)

- **Export conventions:**
    - Named exports for utilities and types
    - Default exports for class-based connectors only

### File Organization

```
cli/
├── src/
│   ├── commands/           # CLI command modules
│   │   ├── query-activities.ts
│   │   └── sync-activities.ts
│   ├── config/             # Configuration loaders
│   │   └── connectors.config.ts
│   ├── connectors/         # Activity connectors (Strategy pattern)
│   │   ├── commits-connector.ts
│   │   ├── issues-connector.ts
│   │   └── prs-connector.ts
│   ├── core/               # Core business logic
│   │   ├── activity-connector.ts  # Base connector class
│   │   ├── activity-service.ts    # Activity persistence service
│   │   ├── date-utils.ts
│   │   ├── issue-processor.ts
│   │   ├── pr-processor.ts
│   │   └── working-time.ts
│   ├── infrastructure/     # Database layer
│   │   ├── activity-repository.ts  # CRUD operations
│   │   ├── database.ts            # Connection management
│   │   └── schema.ts              # Drizzle ORM schema
│   ├── auth.ts             # GitHub authentication
│   ├── github.ts           # GitHub API client
│   ├── logger.ts           # Logging utilities
│   ├── types.ts            # TypeScript type definitions
│   └── index.ts            # CLI entry point
├── migrations/             # Database migration files
└── drizzle.config.ts       # Drizzle Kit configuration
```

### Adding New Connectors

To add a new connector (e.g., Slack, Jira):

1. Create `cli/src/connectors/new-connector.ts`:

```typescript
import { ActivityConnector, type ConnectorConfig } from '../core/activity-connector.js';
import type { UserActivity } from '../types.js';

export class NewConnector extends ActivityConnector {
  readonly name = 'new-source';

  async fetch(config: ConnectorConfig): Promise<UserActivity[]> {
    // Fetch activities from the source API
    // Return normalized UserActivity[]
  }

  // Optional: Override for custom deduplication key
  generateActivityKey(activity: UserActivity): string {
    return `new-source:${activity.meta?.uniqueId}`;
  }
}
```

2. Update `cli/src/config/connectors.config.ts` to add configuration

3. Register in `cli/src/commands/sync-activities.ts`:

```typescript
if (filteredConfig.newSource?.enabled) {
  connectors.push(new NewConnector());
}
```

### Import Organization

```typescript
// 1. Node.js built-ins
import fs from 'fs/promises';
import path from 'path';

// 2. Third-party
import { Command } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';

// 3. Internal modules
import { ActivityConnector } from '../core/activity-connector.js';
import type { UserActivity } from '../types.js';
```

### Error Handling

```typescript
try {
  await doSomething();
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error(chalk.red(`Error: ${errorMessage}`));
  process.exit(1);
}
```

## General Guidelines

- Use 2 spaces for indentation
- Use single quotes for strings
- Use trailing commas
- Use `const` for variables that don't change
- Use `.js` extension for imports (ESM)
- Register commands with Commander
- Use `dotenv` (.env) for environment
- Set `process.exitCode = 1` on errors
- Use `chalk` for colors
- Use `chrono-node` for natural language date parsing
- All timestamps in UTC ISO 8601 format
- Duration always in seconds

## Database Operations

### Migrations

```bash
# Generate migration from schema changes
pnpm db:generate

# Run migrations
pnpm db:migrate

# Push schema directly (dev only)
pnpm db:push

# Open Drizzle Studio
pnpm db:studio
```

### Upsert Logic

Activities use a `unique_key` for deduplication:
- Key format: `type:author:date:repository:uniqueId`
- On conflict, existing activity is updated
- Prevents duplicate activities from multiple syncs


### Verifications

run 
`npm run cli -- sync-activities --from "24 hours ago"`
to fetch all activities from the last 24 hours.