export interface FetchIssuesOptions {
    owner: string;
    projectNumber: number;
    from?: string;
    to?: string;
    filter?: string;
    onProgress?: (count: number) => void;
}

export interface FetchPRsOptions {
    owner: string;
    repo: string;
    from?: string;
    to?: string;
    onProgress?: (count: number) => void;
}

export interface ProjectV2Item {
    id: string;
    type: string;
    content: {
        __typename: string;
        number?: number;
        title?: string;
        url?: string;
        createdAt?: string;
        updatedAt?: string;
        assignees?: {
            nodes: {
                login: string;
                name: string;
            }[];
        };
        labels?: {
            nodes: {
                name: string;
                color: string;
            }[];
        };
        author?: {
            login: string;
        };
        timelineItems?: {
            nodes: TimelineEvent[];
        }
    };
    fieldValues: {
        nodes: {
            __typename: string;
            name?: string; // For ProjectV2ItemFieldSingleSelectValue
            text?: string; // For ProjectV2ItemFieldTextValue
            date?: string; // For ProjectV2ItemFieldDateValue
            field?: {
                name: string;
            };
        }[];
    };
}

export interface TimelineEvent {
    __typename: string;
    createdAt: string;
    actor?: {
        login: string;
    };
    // For specific events
    label?: { name: string };
    projectColumnName?: string;
    assignee?: { login: string };
    // ProjectV2ItemStatusChangedEvent
    previousStatus?: string;
    status?: string;
}

export interface ProcessedIssue {
    id: string;
    number: number;
    title: string;
    url: string;
    status: string;
    assignees: string[];
    labels: string[];
    updatedAt: string;
    history: IssueHistoryItem[];
    statusDurations: StatusDuration[];
}

export interface StatusDuration {
    status: string;
    durationMs: number;
}

export interface IssueHistoryItem {
    type: string; // 'status' | 'label' | 'assignment' | 'state_change' | 'unknown'
    action: string; // 'moved', 'labeled', 'assigned', 'closed', etc.
    value?: string; // New status, label name, etc.
    who: string;
    when: string;
    durationMs?: number;
}

export interface PullRequestInfo {
    number: number;
    title: string;
    url: string;
    createdAt: string;
    closedAt?: string;
    changedFiles: number;
    reviews: ReviewInfo[];
    comments: CommentInfo[];
    isRequestChanges: boolean;
    requestedChangesBy?: {
        who: string;
        when: string;
    };
    lifetimeMs: number;
}

export interface ReviewInfo {
    who: string;
    when: string;
    state: string;
    body: string;
}

export interface CommentInfo {
    who: string;
    when: string;
    text: string;
}

