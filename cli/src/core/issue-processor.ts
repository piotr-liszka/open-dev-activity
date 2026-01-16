import type { ProjectV2Item, ProcessedIssue, IssueHistoryItem, StatusDuration } from '../types.js';
import dayjs, { type Dayjs } from 'dayjs';

/**
 * Process a ProjectV2 item into a ProcessedIssue with history tracking
 * This function analyzes the item's field changes and creates a timeline of activities
 * 
 * @param item - The ProjectV2 item from GitHub's GraphQL API
 * @param toDate - The end date for filtering activities
 * @returns ProcessedIssue with normalized history and duration tracking
 */
export function processItem(item: ProjectV2Item, toDate: Dayjs): ProcessedIssue {
  const issue = item.content;
  const fieldValues = item.fieldValues?.nodes || [];
  
  // Extract basic issue information with safe defaults
  const processedIssue: ProcessedIssue = {
    id: item.id || `unknown-${Date.now()}`,
    number: issue.number || 0,
    title: issue.title || 'Untitled',
    url: issue.url || '',
    status: 'unknown',
    assignees: [],
    labels: issue.labels?.nodes?.map((label: any) => label.name) || [],
    updatedAt: issue.updatedAt || new Date().toISOString(),
    history: [],
    statusDurations: [],
  };

  // Extract current assignees
  if (issue.assignees?.nodes) {
    processedIssue.assignees = issue.assignees.nodes.map((assignee: any) => assignee.login);
  }

  // Process field values and their history
  const statusHistory: Array<{ status: string; when: string; who: string }> = [];
  
  for (const fieldValue of fieldValues) {
    if (!fieldValue.field) continue;
    
    const field = fieldValue.field;
    const fieldName = field.name.toLowerCase();
    
    // Handle status field
    if (fieldName === 'status') {
      // Field value could be in name, text, or direct value
      const statusValue = fieldValue.name || fieldValue.text || 'unknown';
      processedIssue.status = statusValue;

      // For field values, we don't always have update timestamp or creator
      // This would need to be enriched from timeline events or other sources
    }
  }

  // Process timeline events from the issue (if available)
  if (issue.timelineItems?.nodes) {
    for (const event of issue.timelineItems.nodes) {
      const historyItem = processTimelineEvent(event, issue);
      if (historyItem) {
        processedIssue.history.push(historyItem);
      }
    }
  }

  // Add status changes from field values
  for (let i = 0; i < statusHistory.length; i++) {
    const current = statusHistory[i];
    const previous = i > 0 ? statusHistory[i - 1] : null;
    
    const historyItem: IssueHistoryItem = {
      type: 'status',
      action: 'moved',
      value: current.status,
      who: current.who,
      when: current.when,
    };
    
    // Calculate duration if we have a previous status
    if (previous) {
      const duration = dayjs(current.when).diff(dayjs(previous.when));
      historyItem.durationMs = duration;
    }
    
    processedIssue.history.push(historyItem);
  }

  // Calculate status durations
  processedIssue.statusDurations = calculateStatusDurations(statusHistory, toDate);

  // Sort history by date
  processedIssue.history.sort((a, b) => dayjs(a.when).diff(dayjs(b.when)));

  return processedIssue;
}

/**
 * Process a timeline event into a history item
 * 
 * @param event - Timeline event from GitHub API
 * @param issue - The parent issue
 * @returns IssueHistoryItem or null if event should be ignored
 */
function processTimelineEvent(event: any, issue: any): IssueHistoryItem | null {
  if (!event.__typename || !event.createdAt) {
    return null;
  }

  const baseItem = {
    who: event.actor?.login || 'unknown',
    when: event.createdAt,
  };

  switch (event.__typename) {
    case 'ClosedEvent':
      return {
        ...baseItem,
        type: 'state_change',
        action: 'closed',
        value: 'closed',
      };
      
    case 'ReopenedEvent':
      return {
        ...baseItem,
        type: 'state_change',
        action: 'reopened',
        value: 'open',
      };
      
    case 'LabeledEvent':
      return {
        ...baseItem,
        type: 'label',
        action: 'labeled',
        value: event.label?.name,
      };
      
    case 'UnlabeledEvent':
      return {
        ...baseItem,
        type: 'label',
        action: 'unlabeled',
        value: event.label?.name,
      };
      
    case 'AssignedEvent':
      return {
        ...baseItem,
        type: 'assignment',
        action: 'assigned',
        value: event.assignee?.login,
      };
      
    case 'UnassignedEvent':
      return {
        ...baseItem,
        type: 'assignment',
        action: 'unassigned',
        value: event.assignee?.login,
      };
      
    default:
      // Unknown event type, skip
      return null;
  }
}

/**
 * Calculate how long the issue spent in each status
 * 
 * @param statusHistory - Array of status changes with timestamps
 * @param toDate - End date for calculating current status duration
 * @returns Array of status durations
 */
function calculateStatusDurations(
  statusHistory: Array<{ status: string; when: string; who: string }>,
  toDate: Dayjs
): StatusDuration[] {
  if (statusHistory.length === 0) {
    return [];
  }

  const durations: StatusDuration[] = [];
  
  for (let i = 0; i < statusHistory.length; i++) {
    const current = statusHistory[i];
    const next = i < statusHistory.length - 1 ? statusHistory[i + 1] : null;
    
    let durationMs: number;
    
    if (next) {
      // Duration until next status change
      durationMs = dayjs(next.when).diff(dayjs(current.when));
    } else {
      // Duration until toDate (current status)
      durationMs = toDate.diff(dayjs(current.when));
    }
    
    // Only add positive durations
    if (durationMs > 0) {
      durations.push({
        status: current.status,
        durationMs,
      });
    }
  }

  return durations;
}
