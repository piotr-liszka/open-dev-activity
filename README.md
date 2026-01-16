# GitHub Project CLI

A powerful TypeScript CLI tool for analyzing GitHub repositories, projects, issues, and pull requests.

## Features

- 🔍 **Repository Analysis** - Analyze commits from local repositories and their forks
- 📊 **Project Issues** - Fetch and analyze ProjectV2 items with status history
- 🔀 **Pull Requests** - Detailed PR analysis with reviews and discussions
- ⏱️ **Working Time Calculations** - Smart duration tracking considering working hours
- 🔐 **Flexible Authentication** - Support for both personal tokens and GitHub Apps
- 🗄️ **Database Persistence** - Store activities in PostgreSQL for querying and analysis

## Installation

```bash
pnpm install
```

## Authentication

Set up authentication using one of these methods:

### Personal Access Token
```bash
export GITHUB_TOKEN=your_github_token
```

### GitHub App
```bash
export GITHUB_APP_ID=your_app_id
export GITHUB_APP_INSTALLATION_ID=your_installation_id
export GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
```

### Database (Optional)
For activity persistence, configure PostgreSQL:

#### Option 1: Neon (Recommended for Serverless)
[Neon](https://neon.tech) is a serverless Postgres platform perfect for this project. See [NEON_SETUP.md](./NEON_SETUP.md) for detailed setup instructions.

```bash
# Use Neon's pooled connection string (recommended for applications)
export DATABASE_URL=postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require

# Or use direct connection string (for migrations)
export DATABASE_URL=postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require
```

#### Option 2: Local PostgreSQL
```bash
# Connection string
export DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# Or individual parameters
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=user
export POSTGRES_PASSWORD=password
export POSTGRES_DB=dbname
```

#### Option 3: Docker Compose
Use the included `docker-compose.yml` to run a local PostgreSQL instance:
```bash
docker-compose up -d
# Then set DATABASE_URL=postgresql://openrag:openrag@localhost:5432/openrag
```

## Commands

### 1. Analyze Repositories (Analyze Local Commits)

Analyze commits from a local repository directory and its forks.

```bash
pnpm cli analyse-repos --repo-directory <path> [options]
```

**Required Options:**
- `--repo-directory <string>` - Path to the repository directory (or set `REPO_DIRECTORY` env var)

**Optional Options:**
- `--from <date>` - Start date to analyze commits (default: "7 days ago")
  - Accepts: "7 days ago", "24 hours ago", "30 days ago", or YYYY-MM-DD format
- `--to <date>` - End date to analyze commits (default: "now")
- `--non-interactive` - Run in non-interactive mode (skip confirmation prompt)

**Example:**
```bash
# Analyze a local repository
pnpm cli analyse-repos --repo-directory /path/to/repo

# Custom date range
pnpm cli analyse-repos --repo-directory /path/to/repo --from "30 days ago" --to "now"

# Non-interactive mode (for CI/scripts)
pnpm cli analyse-repos --repo-directory /path/to/repo --non-interactive
```

**Output includes:**
- Summary statistics:
  - Total repositories and commits
  - Lines added/deleted across all commits
  - Unique contributors
- All commits sorted by date (latest first) across all repositories
- For each commit:
  - Commit SHA, author, and repository name
  - Lines added (green) and deleted (red)
  - Commit message
  - Commit date

---

### 2. Fetch Issues

Fetch issues from a GitHub ProjectV2 with detailed status history.

```bash
pnpm cli fetch-issues --owner <owner> --project-number <number> [options]
```

**Required Options:**
- `--owner <string>` - GitHub organization or user
- `--project-number <number>` - ProjectV2 number

**Optional Options:**
- `--from <date>` - Start date (default: "24 hours ago")
  - Accepts: "24 hours ago", "7 days ago", or YYYY-MM-DD format
- `--to <date>` - End date (default: "now")
  - Accepts: "now" or YYYY-MM-DD format

**Example:**
```bash
pnpm cli fetch-issues --owner myorg --project-number 1
pnpm cli fetch-issues --owner myorg --project-number 1 --from "7 days ago"
pnpm cli fetch-issues --owner myorg --project-number 1 --from 2026-01-01 --to 2026-01-07
```

**Output includes:**
- Issue number, title, and URL
- Current status
- Assignees and labels
- Last update time
- Time spent in each status (calculated with working hours)
- Complete history timeline with status changes, label additions, assignments

---

### 3. Fetch Pull Requests

Fetch and analyze pull requests with reviews and discussions.

```bash
pnpm cli fetch-prs --owner <owner> --repo <repo> [options]
```

**Required Options:**
- `--owner <string>` - GitHub organization or user
- `--repo <string>` - Repository name

**Optional Options:**
- `--from <date>` - Start date (default: "7 days ago")
- `--to <date>` - End date (default: "now")

**Example:**
```bash
pnpm cli fetch-prs --owner facebook --repo react
pnpm cli fetch-prs --owner microsoft --repo vscode --from "24 hours ago"
pnpm cli fetch-prs --owner myorg --repo myrepo --from 2026-01-01 --to 2026-01-07
```

**Output includes:**
- PR number, title, and URL
- Creation date
- Number of files changed
- PR lifetime (calculated with working hours)
- "Request Changes" status with reviewer and timestamp
- Complete discussion history:
  - Regular comments
  - Review comments
  - Review thread discussions
  - All sorted chronologically with author and timestamp

---

### 4. Database Migration

Run database migrations to set up the schema for activity persistence.

```bash
pnpm cli db-migrate [options]
```

**Optional Options:**
- `--check` - Only check database connectivity without running migrations

**Example:**
```bash
# Run migrations
pnpm cli db-migrate

# Check database connectivity
pnpm cli db-migrate --check
```

**Output includes:**
- Migration status
- Activities table schema
- Database indexes

---

### 5. Query Activities

Query stored activities from the database.

```bash
pnpm cli query-activities [options]
```

**Optional Options:**
- `--author <string>` - Filter by author
- `--repository <string>` - Filter by repository
- `--type <string>` - Filter by activity type (commit, pr_created, pr_review, pr_comment, issue_status_change, issue_assignment, issue_labeling, issue_state_change)
- `--from <date>` - Start date (YYYY-MM-DD)
- `--to <date>` - End date (YYYY-MM-DD)
- `--limit <number>` - Maximum number of results (default: 100)
- `--offset <number>` - Skip first N results (default: 0)
- `--count-only` - Only show count, not full results
- `--format <string>` - Output format: json, table (default: json)

**Example:**
```bash
# Query all activities
pnpm cli query-activities

# Filter by author
pnpm cli query-activities --author "john@example.com"

# Filter by type and date range
pnpm cli query-activities --type commit --from 2026-01-01 --to 2026-01-07

# Table format output
pnpm cli query-activities --format table --limit 50

# Count only
pnpm cli query-activities --author "john@example.com" --count-only
```

**Output includes:**
- Activity type, author, date
- Repository and title
- URL and description
- Additional metadata (varies by activity type)

---

## Working Time Calculations

The CLI intelligently calculates durations considering:
- **Working Hours**: Monday-Friday, 9:00 AM - 5:00 PM
- **Excludes**: Weekends and non-working hours
- **Format**: Human-readable (e.g., "2d 3h 45m")

This provides more accurate time tracking for project management and analysis.

## Development

```bash
# Run CLI commands
pnpm cli <command>

# Lint code
pnpm lint

# Format code
pnpm format

# Database operations (using Drizzle Kit)
pnpm db:generate  # Generate migrations
pnpm db:migrate   # Run migrations
pnpm db:push      # Push schema changes
pnpm db:studio    # Open Drizzle Studio
```

## Project Structure

```
cli/
├── src/
│   ├── commands/
│   │   ├── analyse-repos.ts     # Repository analysis command
│   │   ├── db-migrate.ts        # Database migration command
│   │   ├── fetch-issues.ts      # ProjectV2 issues command
│   │   ├── fetch-prs.ts         # Pull requests command
│   │   └── query-activities.ts  # Query activities command
│   ├── core/
│   │   ├── date-utils.ts        # Date parsing utilities
│   │   └── working-time.ts      # Working time calculations
│   ├── infrastructure/
│   │   ├── activity-repository.ts # Activity database queries
│   │   ├── database.ts          # Database connection
│   │   └── schema.ts            # Drizzle ORM schema
│   ├── auth.ts                  # Authentication handling
│   ├── github.ts                # GitHub API client
│   ├── logger.ts                # Logging utilities
│   ├── types.ts                 # TypeScript type definitions
│   └── index.ts                 # CLI entry point
├── drizzle/                     # Database migrations
└── package.json
```

## License

MIT
