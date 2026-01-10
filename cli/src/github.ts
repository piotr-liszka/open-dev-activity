import { graphql } from '@octokit/graphql';
import type { FetchIssuesOptions, FetchPRsOptions, ProjectV2Item } from './types.js';
import dayjs from 'dayjs';

export class GitHubClient {
  private token: string;
  private graphqlWithAuth: typeof graphql;

  constructor(token: string) {
    this.token = token;
    this.graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${this.token}`,
        'GraphQL-Features': 'projects_v2_api',
      },
    });
  }

  async getAuthenticatedUser(): Promise<string> {
    try {
      const response: ViewerResponse = await this.graphqlWithAuth(`
                query {
                    viewer {
                        login
                    }
                }
            `);
      return response.viewer.login;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Failed to fetch authenticated user info:', errorMessage);
      return 'unknown';
    }
  }

  async fetchProjectItems(options: FetchIssuesOptions): Promise<ProjectV2Item[]> {
    const { owner, projectNumber } = options;

    // We need to fetch the Organization or User first to get the ProjectV2 ID,
    // but we can query directly by number if we know the owner type (Org or User).
    // We'll trust the user provides an Owner that is either.
    // However, finding the project often implies searching or knowing the node ID.
    // Easier path: Query Organization -> projectV2(number: X) OR User -> projectV2(number: X)
    // We'll try Organization first, if null try User? Or just ask the user?
    // Let's assume Organization for now as "ProjectV2" is usually Org-level.
    // If it fails, we fall back to User.

    const itemsFragment = `
            items(first: 100, after: $cursor, query: $filterQuery) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                type
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      text
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldDateValue {
                      date
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                  }
                }
                content {
                    ... on Issue {
                        __typename
                        number
                        title
                        url
                        createdAt
                        updatedAt
                        author { login }
                        assignees(first: 10) {
                            nodes { login name }
                        }
                        labels(first: 10) {
                            nodes { name color }
                        }
                        timelineItems(last: 100) {
                             nodes {
                                __typename
                                ... on LabeledEvent {
                                    createdAt
                                    actor { login }
                                    label { name }
                                }
                                ... on MovedColumnsInProjectEvent {
                                    createdAt
                                    actor { login }
                                    projectColumnName
                                }
                                ... on ClosedEvent {
                                    createdAt
                                    actor { login }
                                }
                                ... on ReopenedEvent {
                                    createdAt
                                    actor { login }
                                }
                                ... on AssignedEvent {
                                    createdAt
                                    actor { login }
                                    assignee { ... on User { login } }
                                }
                                ... on UnassignedEvent {
                                    createdAt
                                    actor { login }
                                    assignee { ... on User { login } }
                                }
                                ... on ProjectV2ItemStatusChangedEvent {
                                    createdAt
                                    actor { login }
                                    previousStatus
                                    status
                                }
                             }
                        }
                    }
                    ... on PullRequest {
                        __typename
                        number
                        title
                        url
                        createdAt
                        updatedAt
                        author { login }
                        assignees(first: 10) {
                            nodes { login name }
                        }
                         labels(first: 10) {
                            nodes { name color }
                        }
                    }
                }
              }
            }
        `;

    const orgQuery = `
          query($owner: String!, $number: Int!, $cursor: String, $filterQuery: String) {
            organization(login: $owner) {
              projectV2(number: $number) {
                ${itemsFragment}
              }
            }
          }
        `;

    const userQuery = `
          query($owner: String!, $number: Int!, $cursor: String, $filterQuery: String) {
            user(login: $owner) {
              projectV2(number: $number) {
                ${itemsFragment}
              }
            }
          }
        `;

    const allItems: ProjectV2Item[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let activeQuery = orgQuery;

    // Initial check to determine query type and fetch first batch
    // We do this loop structure to support pagination + retries/fallback logic

    let loopCount = 0;
    let checkedUserFallback = false;

    while (hasNextPage && loopCount < 100) {
      loopCount++;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let response: any;
        try {
          response = await this.graphqlWithAuth(activeQuery, {
            owner,
            number: parseInt(String(projectNumber), 10),
            cursor,
            filterQuery: options.filter,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // Fallback logic: if Org query fails, and we haven't tried User yet, switch to User.
          if (activeQuery === orgQuery && !checkedUserFallback) {
            activeQuery = userQuery;
            checkedUserFallback = true;
            // Retry immediately
            loopCount--; // Don't count this as a loop iteration
            continue;
          }
          throw error;
        }

        // Extract project
        let project;
        if (response.organization) {
          project = response.organization.projectV2;
        } else if (response.user) {
          project = response.user.projectV2;
        }

        // If query returned but field is null (e.g. Organization not found -> null)
        // If using orgQuery and result is null/empty for organization?
        if (activeQuery === orgQuery && !response.organization && !checkedUserFallback) {
          activeQuery = userQuery;
          checkedUserFallback = true;
          loopCount--;
          continue;
        }

        if (!project) {
          throw new Error(`ProjectV2 not found for owner ${owner} and number ${projectNumber}`);
        }

        const items = project.items.nodes;
        allItems.push(...items);

        if (options.onProgress) {
          options.onProgress(allItems.length);
        }

        hasNextPage = project.items.pageInfo.hasNextPage;
        cursor = project.items.pageInfo.endCursor;
      } catch (error) {
        console.error('Error fetching project items:', error);
        throw error;
      }
    }

    return allItems;
  }

  async fetchPullRequests(
    options: FetchPRsOptions
  ): Promise<PullRequestsResponse['repository']['pullRequests']['nodes']> {
    const { owner, repo } = options;

    const query = `
          query($owner: String!, $repo: String!, $cursor: String) {
            repository(owner: $owner, name: $repo) {
              pullRequests(first: 20, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  number
                  title
                  url
                  createdAt
                  closedAt
                  changedFiles
                  author { login }
                  reviews(first: 50) {
                    nodes {
                      author { login }
                      createdAt
                      state
                      body
                    }
                  }
                  comments(first: 50) {
                    nodes {
                      author { login }
                      createdAt
                      body
                    }
                  }
                  reviewThreads(first: 30) {
                    nodes {
                      comments(first: 30) {
                        nodes {
                          author { login }
                          createdAt
                          body
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

    const allPRs: PullRequestsResponse['repository']['pullRequests']['nodes'] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage && allPRs.length < 500) {
      const response: PullRequestsResponse = await this.graphqlWithAuth(query, {
        owner,
        repo,
        cursor,
      });

      const prs = response.repository.pullRequests.nodes;
      allPRs.push(...prs);

      if (options.onProgress) {
        options.onProgress(allPRs.length);
      }

      hasNextPage = response.repository.pullRequests.pageInfo.hasNextPage;
      cursor = response.repository.pullRequests.pageInfo.endCursor;

      // Optional: Break early if PRs are older than 'from' date if specified
      if (options.from && prs.length > 0) {
        const lastPR = prs[prs.length - 1];
        if (dayjs(lastPR.createdAt).isBefore(dayjs(options.from))) {
          hasNextPage = false;
        }
      }
    }

    return allPRs;
  }
}
