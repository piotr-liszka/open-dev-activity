# AGENTS.md - Developer Work Aggregation Platform

This file contains instructions for AI coding agents working with the Developer Work Aggregation Platform. For general contributor guidelines, see README.md.

## Project Overview

The Developer Work Aggregation Platform is a TypeScript-based system that fetches, normalizes, and analyzes developer activity from multiple sources (repositories, project management systems, issue trackers, Slack, calendars, and more). The platform provides unified analytics to understand developer productivity, bottlenecks, and work patterns.

**Core Purpose:** Aggregate disparate data sources into a unified developer activity database, then provide insights through APIs and dashboards.

**Technology Stack:**
- TypeScript (strict mode, ES2020+)
- Node.js 18+
- Commander.js for CLI
- Async data pipelines
- Multi-source integration (ETL patterns)
- Centralized data warehouse/lake

## Dev Environment Setup

### Initial Setup

1. Install dependencies:
   ```bash
   npm install
   # or
   pnpm install
   ```

2. Build the project:
   ```bash
   npm run build
   # or for watch mode during development
   npm run dev
   ```

3. Create environment configuration:
   ```bash
   cp .env.example .env
   # Edit .env with API keys and credentials for:
   # - GitHub
   ```

### Useful Development Commands

- **Run help** `npx tsx src/index.ts  --help` (or `pnpm run cli --help`)

## Code Style & Conventions

### TypeScript Standards

- **Strict mode enabled:** No `any` types without `// @ts-ignore` comment
- **Naming conventions:**
    - Types: PascalCase (`User`, `Activity`, `GitHubResponse`)
    - Interfaces: PascalCase, prefer interfaces over types for objects
    - Variables/functions: camelCase (`fetchUser`, `developerName`)
    - Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`, `API_TIMEOUT`)
    - Private properties: `_privateField`

- **Export conventions:**
    - Named exports for utilities and types
    - Default exports for class-based connectors only

### File Organization

```
src/
├── __tests  # tests
├── commands #  command modules
│   ├── ...
├── utils    #  utility functions
│   ├── utils.ts
│   ├── working-time.ts
├── github.ts
├── types.ts
├── auth.ts
└── index.ts # Commander.js entry, subcommand routing
```

### Error Handling

All functions should have explicit error types:

```typescript
// Good
async function fetchRepositories(token: string): Promise<Repository[]> {
  try {
    const response = await client.get('/repos');
    return response.data;
  } catch (error) {
    if (error instanceof NetworkError) {
      logger.warn('Network error, will retry');
      throw error;  // Let retry handler deal with it
    } else if (error instanceof AuthenticationError) {
      logger.error('Invalid token');
      throw new ConfigurationError('GitHub token expired');
    }
    throw error;
  }
}

// Bad
async function fetchRepositories(token: string): Promise<any> {
  const response = await client.get('/repos');  // No error handling
  return response.data;
}
```

### Import Organization

```typescript
// 1. Node.js built-ins
import fs from 'fs/promises';
import path from 'path';

// 2. Third-party
import axios from 'axios';
import { z } from 'zod';

// 3. Internal: utils/core
import { Logger } from '@project/core/logger';
import { retry } from '@project/core/retry';

// 4. Internal: same package
import { GitHubClient } from './client';
import type { Repository } from './types';
```

## Connector Development Guide

### Adding a New Data Source

1. **Create connector package:**
   ```bash
   mkdir packages/connectors/newsource
   ```

2. **Implement required files:**
    - `types.ts` - Source API types
    - `client.ts` - API client
    - `fetcher.ts` - Data fetching logic
    - `mapper.ts` - Map to universal schema
    - `auth.ts` - Authentication

## Analytics Engine

### Supported Metrics

Core metrics calculated in `packages/analytics/metrics.ts`:

- **Velocity:** Commits, PRs, issues closed per week/month
- **Code Review:** Average review time, review participation rate
- **Collaboration:** Interactions per developer, cross-team communication
- **Workload:** Activities per time period, work distribution
- **Trends:** Historical comparison, anomaly detection

## General Guidelines
- Use 2 spaces for indentation
- Use single quotes for strings
- Use trailing commas
- Use const for variables that don't change
- Use let for variables that change
- Use const for function parameters
- Register commands with Commander
- Use `dotenv` (.env) for environment
- Set `process.exitCode = 1` on errors
- Validate with Zod, set exitCode on errors
- Share similar code between commands, (make smaller functions)
- Share options, arguments and flags between commands
- Use `chalk` for colors
- Use `ora` for loading indicators
- Use `inquirer` for interactive prompts
- Always add ability to run non-interactively (with flag or env var)

### Timestamp Handling

- All timestamps converted to UTC ISO 8601
- Timezone info preserved in metadata
- Duration always in seconds
- Handle daylight saving time transitions

### Handle errors:**

```typescript
try {
  await doSomething();
} catch (error) {
  logger.error(`Failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
  return;
}
```
