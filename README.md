# GitHub Project CLI

A powerful TypeScript CLI tool for analyzing GitHub repositories, projects, issues, and pull requests.

## Features

- 🔍 **Repository Analysis** - Comprehensive repository statistics and insights
- 📊 **Project Issues** - Fetch and analyze ProjectV2 items with status history
- 🔀 **Pull Requests** - Detailed PR analysis with reviews and discussions
- ⏱️ **Working Time Calculations** - Smart duration tracking considering working hours
- 🔐 **Flexible Authentication** - Support for both personal tokens and GitHub Apps

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

## Commands

### 1. Analyze Repository (Fetch Recent Commits)

Fetch recent commits from all repositories owned by a user or organization.

```bash
pnpm cli analyze-repo --owner <owner> [options]
```

**Required Options:**
- `--owner <string>` - GitHub organization or user

**Optional Options:**
- `--commits <number>` - Number of recent commits to fetch per repository (default: 10)
- `--from <date>` - Start date to filter commits (default: "7 days ago")
  - Accepts: "7 days ago", "24 hours ago", "30 days ago", or YYYY-MM-DD format
- `--include-forks <boolean>` - Include forked repositories (default: true)
  - Use `--include-forks=false` to exclude forks
- `--include-merges` - Include merge commits (by default, merge commits are excluded)

**Example:**
```bash
# Include all repositories (default)
pnpm cli analyze-repo --owner facebook

# Exclude forked repositories
pnpm cli analyze-repo --owner microsoft --include-forks=false

# Custom date range and commit count
pnpm cli analyze-repo --owner myuser --commits 20 --from "30 days ago"

# Include merge commits
pnpm cli analyze-repo --owner myorg --include-merges
```

**Output includes:**
- Summary statistics:
  - Total repositories and commits
  - Lines added/deleted across all commits
  - Net change in lines of code
  - Date range
- All commits sorted by date (latest first) across all repositories
- For each commit:
  - Commit SHA, author, and repository name
  - **Branch information** - Shows which branches contain the commit (e.g., `[main]`, `[develop, staging]`)
  - Lines added (green) and deleted (red)
  - Commit message
  - Commit date

**Note:** Merge commits ("Merge pull request", "Merge branch", "Merge tag") are automatically excluded unless `--include-merges` is specified.

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
pnpm cli fetch-prs --owner myorg --myrepo --from 2026-01-01 --to 2026-01-07
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

## Working Time Calculations

The CLI intelligently calculates durations considering:
- **Working Hours**: Monday-Friday, 9:00 AM - 5:00 PM
- **Excludes**: Weekends and non-working hours
- **Format**: Human-readable (e.g., "2d 3h 45m")

This provides more accurate time tracking for project management and analysis.

## Development

```bash
# Build the project
pnpm build

# Run in development
pnpm dev

# Run tests
pnpm test
```

## Project Structure

```
cli/
├── src/
│   ├── commands/
│   │   ├── analyze-repo.ts    # Repository analysis command
│   │   ├── fetch-issues.ts    # ProjectV2 issues command
│   │   └── fetch-prs.ts       # Pull requests command
│   ├── auth.ts                # Authentication handling
│   ├── github.ts              # GitHub API client
│   ├── types.ts               # TypeScript type definitions
│   ├── utils.ts               # Utility functions
│   ├── working-time.ts        # Working time calculations
│   └── index.ts               # CLI entry point
└── package.json
```

## License

MIT
