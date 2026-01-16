import type { UserActivity } from '../types.js';
import {
  saveActivities,
  findActivities,
  countActivities,
  type ActivityQueryOptions
} from '../infrastructure/activity-repository.js';
import { logInfo } from '../logger.js';
import chalk from 'chalk';

/**
 * Result of saving activities
 */
export interface SaveActivitiesResult {
  saved: number;
  errors: string[];
}

/**
 * Service for managing developer activities
 * 
 * This service orchestrates the saving of activities from various connectors
 * into the database using the repository pattern. It provides:
 * 
 * - Batch processing of activities
 * - Error handling and reporting
 * - Deduplication through upsert logic
 * - Transaction management
 * 
 * Following SOLID principles:
 * - Single Responsibility: Manages activity persistence operations
 * - Dependency Inversion: Depends on ActivityRepository abstraction
 */
export class ActivityService {

  /**
   * Save multiple activities to the database
   * Uses upsert logic to handle duplicates based on unique keys
   * 
   * @param activities - Array of activities to save
   * @returns Promise resolving to save result with count and errors
   */
  async saveActivities(activities: UserActivity[]): Promise<SaveActivitiesResult> {
    if (activities.length === 0) {
      return { saved: 0, errors: [] };
    }

    logInfo(chalk.blue(`\nSaving ${activities.length} activities to database...\n`));

    const errors: string[] = [];
    let saved = 0;

    // Process activities in batches to avoid overwhelming the database
    const batchSize = 50;
    const totalBatches = Math.ceil(activities.length / batchSize);

    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * batchSize;
      const endIdx = Math.min(startIdx + batchSize, activities.length);
      const batch = activities.slice(startIdx, endIdx);

      logInfo(chalk.gray(`  Processing batch ${i + 1}/${totalBatches} (${batch.length} activities)...`));

      try {
        const batchResult = await this.saveBatch(batch);
        saved += batchResult.saved;
        errors.push(...batchResult.errors);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Batch ${i + 1} failed: ${errorMessage}`);
        logInfo(chalk.red(`    ✗ Batch ${i + 1} failed: ${errorMessage}`));
      }
    }

    logInfo(chalk.green(`  ✓ Completed: ${saved} activities saved`));
    if (errors.length > 0) {
      logInfo(chalk.red(`  ✗ Errors: ${errors.length}`));
    }

    return { saved, errors };
  }

  /**
   * Save a batch of activities
   * 
   * @param batch - Array of activities to save in this batch
   * @returns Promise resolving to save result for this batch
   */
  private async saveBatch(batch: UserActivity[]): Promise<SaveActivitiesResult> {
    const errors: string[] = [];
    let saved = 0;

    // Use the repository's bulk save function for better performance
    try {
      const savedIds = await saveActivities(batch);
      saved = savedIds.length;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Batch save failed: ${errorMessage}`);
    }

    return { saved, errors };
  }

  /**
   * Get activity statistics for reporting
   * 
   * @param fromDate - Start date for statistics
   * @param toDate - End date for statistics
   * @returns Promise resolving to activity statistics
   */
  async getActivityStats(fromDate?: Date, toDate?: Date): Promise<{
    totalActivities: number;
    activitiesByType: Record<string, number>;
    activitiesByAuthor: Record<string, number>;
    activitiesByRepository: Record<string, number>;
  }> {
    const total = await countActivities();

    // For now, return basic stats
    // TODO: Implement detailed stats queries in the repository
    return {
      totalActivities: total,
      activitiesByType: {},
      activitiesByAuthor: {},
      activitiesByRepository: {},
    };
  }

  /**
   * Get recent activities for a specific author
   * 
   * @param author - Author to get activities for
   * @param limit - Maximum number of activities to return
   * @returns Promise resolving to array of recent activities
   */
  async getRecentActivitiesForAuthor(author: string, limit: number = 10): Promise<UserActivity[]> {
    const queryOptions: ActivityQueryOptions = {
      author,
      limit,
      offset: 0,
    };
    
    const activities = await findActivities(queryOptions);
    return activities;
  }

  /**
   * Get activities for a specific date range and repository
   * 
   * @param repository - Repository to filter by
   * @param fromDate - Start date
   * @param toDate - End date
   * @returns Promise resolving to array of activities
   */
  async getActivitiesForRepository(
    repository: string, 
    fromDate?: Date, 
    toDate?: Date
  ): Promise<UserActivity[]> {
    const queryOptions: ActivityQueryOptions = {
      repository,
      fromDate,
      toDate,
      limit: 1000,
      offset: 0,
    };
    
    const activities = await findActivities(queryOptions);
    return activities;
  }
}
