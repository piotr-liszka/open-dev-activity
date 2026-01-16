import type { UserActivity } from '../types.js';
import type { Dayjs } from 'dayjs';

/**
 * Configuration for activity connectors
 */
export interface ConnectorConfig {
  enabled: boolean;
  from: Dayjs;
  to: Dayjs;
  owner?: string;
  repo?: string;
  projectNumber?: number;
  repoDirectory?: string;
}

/**
 * Result returned by activity connectors
 */
export interface ConnectorResult {
  activities: UserActivity[];
  connectorName: string;
  success: boolean;
  error?: string;
  count: number;
}

/**
 * Base class for all activity connectors
 * Implements the Strategy pattern for different data sources
 *
 * Following SOLID principles:
 * - Single Responsibility: Each connector handles one data source
 * - Open-Closed: New connectors can extend this base class
 * - Liskov Substitution: All connectors are interchangeable
 * - Interface Segregation: Minimal interface focused on activity fetching
 * - Dependency Inversion: Depends on abstractions (UserActivity interface)
 */
export abstract class ActivityConnector {
  /**
   * Name identifier for the connector (issues, prs, commits, etc.)
   */
  abstract readonly name: string;

  /**
   * Fetch activities from the data source
   * @param config - Connector configuration including date range and source-specific options
   * @returns Promise resolving to array of normalized UserActivity objects
   */
  abstract fetch(config: ConnectorConfig): Promise<UserActivity[]>;

  /**
   * Generate a unique key for an activity to prevent duplicates
   * Default implementation uses type:author:date:repository pattern
   * Override for source-specific deduplication logic
   *
   * @param activity - The activity to generate a key for
   * @returns Unique string key for the activity
   */
  generateActivityKey(activity: UserActivity): string {
    // Default implementation - can be overridden by specific connectors
    const uniqueId = activity.meta?.hash ||
                     activity.meta?.issueNumber ||
                     activity.meta?.prNumber ||
                     activity.meta?.commentId ||
                     activity.meta?.reviewId ||
                     activity.url ||
                     activity.title ||
                     'unknown';

    const dateStr = new Date(activity.date).toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = new Date(activity.date).toISOString().split('T')[1].split('.')[0]; // HH:mm:ss

    return `${activity.type}:${activity.author}:${dateStr}T${timeStr}:${activity.repository}:${uniqueId}`;
  }

  /**
   * Execute the connector and return a standardized result
   * This method wraps the fetch() method with error handling and result formatting
   *
   * @param config - Connector configuration
   * @returns Promise resolving to ConnectorResult with success/error information
   */
  async execute(config: ConnectorConfig): Promise<ConnectorResult> {
    try {
      const activities = await this.fetch(config);
      return {
        activities,
        connectorName: this.name,
        success: true,
        count: activities.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        activities: [],
        connectorName: this.name,
        success: false,
        error: errorMessage,
        count: 0,
      };
    }
  }
}
