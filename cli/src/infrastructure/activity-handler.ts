import {
  eventBus,
  type ActivityCreatedEvent,
  type ActivitiesBatchEvent,
} from '../core/event-bus.js';
import { saveActivity, saveActivities } from './activity-repository.js';
import { isConnected } from './database.js';
import { logInfo } from '../logger.js';
import chalk from 'chalk';

/**
 * Register event handlers for persisting activities to database
 */
export function registerActivityHandlers(): void {
  // Handler for single activity
  eventBus.subscribe<ActivityCreatedEvent>('ACTIVITY_CREATED', async (event) => {
    if (!isConnected()) {
      return; // Skip if database not connected
    }

    try {
      await saveActivity(event.payload);
      logInfo(chalk.gray(`  Saved activity: ${event.payload.type} by ${event.payload.author}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red(`Failed to save activity: ${message}`));
    }
  });

  // Handler for batch activities
  eventBus.subscribe<ActivitiesBatchEvent>('ACTIVITIES_BATCH', async (event) => {
    if (!isConnected()) {
      return; // Skip if database not connected
    }

    try {
      const count = event.payload.length;
      await saveActivities(event.payload);
      logInfo(chalk.green(`  Saved ${count} activities to database`));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(chalk.red(`Failed to save activities batch: ${message}`));
    }
  });

  logInfo(chalk.gray('Activity handlers registered'));
}
