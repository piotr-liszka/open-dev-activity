import { eq, and, gte, lte, desc, count, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import type { UserActivity } from '../types.js';
import { getDb, isConnected } from './database.js';
import { activities, type Activity, type NewActivity } from './schema.js';

export interface StoredActivity extends UserActivity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityQueryOptions {
  author?: string;
  repository?: string;
  type?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Generate a unique key for an activity
 * This is used for deduplication and upsert logic
 * Ensures the key is within the 500 character limit by hashing if needed
 */
export function generateActivityKey(activity: UserActivity): string {
  // Use meta.hash for commits, meta.issueNumber for issues, meta.prNumber for PRs
  const uniqueId = activity.meta?.hash || 
                   activity.meta?.issueNumber || 
                   activity.meta?.prNumber || 
                   activity.meta?.commentId ||
                   activity.meta?.reviewId ||
                   activity.url || 
                   activity.title || 
                   'unknown';
  
  // Create a composite key: type:author:date:repository:uniqueId
  const dateStr = new Date(activity.date).toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = new Date(activity.date).toISOString().split('T')[1].split('.')[0]; // HH:mm:ss

  // For issue activities, include action and a hash of value for uniqueness
  // This prevents conflicts when multiple status changes happen at the same timestamp
  let actionSuffix = '';
  if (activity.type.startsWith('issue_') && activity.meta?.action) {
    const action = String(activity.meta.action);
    const value = activity.meta?.value ? String(activity.meta.value) : '';
    // Create a short hash of the value to keep the key manageable
    const valueHash = value ? createHash('sha256').update(value).digest('hex').substring(0, 8) : '';
    actionSuffix = `:${action}${valueHash ? ':' + valueHash : ''}`;
  }

  const key = `${activity.type}:${activity.author}:${dateStr} ${timeStr}:${activity.repository}:${uniqueId}${actionSuffix}`;

  // If key exceeds 500 characters, hash the long parts
  if (key.length > 500) {
    // Keep the essential parts and hash the rest
    const essential = `${activity.type}:${activity.author}:${dateStr} ${timeStr}:${activity.repository}:`;
    const remaining = `${uniqueId}${actionSuffix}`;

    if (essential.length + remaining.length > 500) {
      // Hash the uniqueId + actionSuffix if it's too long
      const hash = createHash('sha256').update(remaining).digest('hex').substring(0, 32);
      return `${essential}${hash}`;
    }
    
    // Truncate if still too long
    const maxRemaining = 500 - essential.length;
    return `${essential}${remaining.substring(0, maxRemaining)}`;
  }
  
  return key;
}

/**
 * Convert UserActivity to NewActivity for database insertion
 * Validates and normalizes data before insertion
 */
function toNewActivity(activity: UserActivity, uniqueKey: string): NewActivity {
  // Validate required fields
  if (!activity.type || !activity.author || !activity.date || !activity.repository) {
    throw new Error(`Invalid activity: missing required fields. Type: ${activity.type}, Author: ${activity.author}, Date: ${activity.date}, Repository: ${activity.repository}`);
  }

  // Ensure uniqueKey is within limit
  const finalKey = uniqueKey.length > 500 ? uniqueKey.substring(0, 500) : uniqueKey;
  
  // Ensure meta is always an object (not null or undefined)
  const meta = activity.meta && typeof activity.meta === 'object' ? activity.meta : {};
  
  // Validate string lengths match schema constraints
  const type = activity.type.length > 50 ? activity.type.substring(0, 50) : activity.type;
  const author = activity.author.length > 255 ? activity.author.substring(0, 255) : activity.author;
  const repository = activity.repository.length > 500 ? activity.repository.substring(0, 500) : activity.repository;

  return {
    uniqueKey: finalKey,
    type,
    author,
    activityDate: new Date(activity.date),
    repository,
    url: activity.url || null,
    title: activity.title || null,
    description: activity.description || null,
    meta,
  };
}

/**
 * Convert database Activity to StoredActivity
 */
function toStoredActivity(row: Activity): StoredActivity {
  return {
    id: row.id,
    type: row.type as UserActivity['type'],
    author: row.author,
    date: row.activityDate.toISOString(),
    repository: row.repository,
    url: row.url || undefined,
    title: row.title || undefined,
    description: row.description || undefined,
    meta: (row.meta || {}) as Record<string, unknown>,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

/**
 * Find activity by unique key
 */
export async function findByUniqueKey(uniqueKey: string): Promise<StoredActivity | null> {
  const db = getDb();
  if (!db || !isConnected()) {
    throw new Error('Database not connected');
  }

  const [result] = await db
    .select()
    .from(activities)
    .where(eq(activities.uniqueKey, uniqueKey))
    .limit(1);

  return result ? toStoredActivity(result) : null;
}

/**
 * Save a single activity to the database (insert or update if exists)
 * Uses upsert logic based on uniqueKey
 */
export async function saveActivity(activity: UserActivity, uniqueKey?: string): Promise<string> {
  const db = getDb();
  if (!db || !isConnected()) {
    throw new Error('Database not connected');
  }

  const key = uniqueKey || generateActivityKey(activity);
  const newActivity = toNewActivity(activity, key);

  try {
    // Use PostgreSQL ON CONFLICT for upsert
    const results = await db
      .insert(activities)
      .values(newActivity)
      .onConflictDoUpdate({
        target: activities.uniqueKey,
        set: {
          type: sql`EXCLUDED.type`,
          author: sql`EXCLUDED.author`,
          activityDate: sql`EXCLUDED.activity_date`,
          repository: sql`EXCLUDED.repository`,
          url: sql`EXCLUDED.url`,
          title: sql`EXCLUDED.title`,
          description: sql`EXCLUDED.description`,
          meta: sql`EXCLUDED.meta`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({ id: activities.id });

    if (!results || results.length === 0) {
      throw new Error(
        `No result returned from database insert. ` +
        `Activity: type=${activity.type}, author=${activity.author}, date=${activity.date}, repo=${activity.repository}, uniqueKey=${key}`
      );
    }

    return results[0].id;
  } catch (error) {
    // Drizzle wraps PostgreSQL errors - extract the actual cause
    const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause: unknown }).cause : error;
    const pgError = cause as { code?: string; detail?: string; constraint?: string; message?: string };
    const errorCode = pgError.code ? ` [Code: ${pgError.code}]` : '';
    const errorDetail = pgError.detail ? ` Detail: ${pgError.detail}` : '';
    const errorConstraint = pgError.constraint ? ` Constraint: ${pgError.constraint}` : '';
    const baseMessage = pgError.message || (error instanceof Error ? error.message : 'Unknown database error');

    throw new Error(
      `Database error saving activity${errorCode}${errorConstraint}: ${baseMessage}${errorDetail}. ` +
      `Activity: type=${activity.type}, author=${activity.author}, date=${activity.date}, repo=${activity.repository}, uniqueKey=${key}`
    );
  }
}

/**
 * Save multiple activities in a batch with upsert logic
 * Uses ON CONFLICT to update existing activities
 * Batches large inserts to avoid query size limits
 */
export async function saveActivities(
  activitiesList: UserActivity[],
  generateKey?: (activity: UserActivity) => string
): Promise<string[]> {
  const db = getDb();
  if (!db || !isConnected()) {
    throw new Error('Database not connected');
  }

  if (activitiesList.length === 0) {
    return [];
  }

  const keyGenerator = generateKey || generateActivityKey;
  const BATCH_SIZE = 100; // Process in batches to avoid query size limits
  const allIds: string[] = [];

  // Process in batches
  for (let i = 0; i < activitiesList.length; i += BATCH_SIZE) {
    const batch = activitiesList.slice(i, i + BATCH_SIZE);
    
    try {
      const newActivities = batch.map((activity) => {
        try {
          return toNewActivity(activity, keyGenerator(activity));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown validation error';
          throw new Error(`Failed to prepare activity for insertion: ${errorMsg}. Activity: ${JSON.stringify(activity)}`);
        }
      });

      // Use PostgreSQL ON CONFLICT for batch upsert
      const results = await db
        .insert(activities)
        .values(newActivities)
        .onConflictDoUpdate({
          target: activities.uniqueKey,
          set: {
            type: sql`EXCLUDED.type`,
            author: sql`EXCLUDED.author`,
            activityDate: sql`EXCLUDED.activity_date`,
            repository: sql`EXCLUDED.repository`,
            url: sql`EXCLUDED.url`,
            title: sql`EXCLUDED.title`,
            description: sql`EXCLUDED.description`,
            meta: sql`EXCLUDED.meta`,
            updatedAt: sql`NOW()`,
          },
        })
        .returning({ id: activities.id });

      allIds.push(...results.map((r) => r.id));
    } catch (error) {
      // Drizzle wraps PostgreSQL errors - extract the actual cause
      const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause: unknown }).cause : error;
      const pgError = cause as { code?: string; detail?: string; constraint?: string; hint?: string; message?: string };
      const errorCode = pgError.code ? ` [Code: ${pgError.code}]` : '';
      const errorDetail = pgError.detail ? ` Detail: ${pgError.detail}` : '';
      const errorConstraint = pgError.constraint ? ` Constraint: ${pgError.constraint}` : '';
      const errorHint = pgError.hint ? ` Hint: ${pgError.hint}` : '';
      const baseMessage = pgError.message || (error instanceof Error ? error.message : 'Unknown error');

      throw new Error(
        `Failed to save activities batch (${i + 1}-${Math.min(i + BATCH_SIZE, activitiesList.length)} of ${activitiesList.length})${errorCode}${errorConstraint}: ${baseMessage}${errorDetail}${errorHint}`
      );
    }
  }

  return allIds;
}

/**
 * Build where conditions for activity queries
 */
function buildWhereConditions(options: ActivityQueryOptions): ReturnType<typeof and> | undefined {
  const conditions = [];

  if (options.author) {
    conditions.push(eq(activities.author, options.author));
  }

  if (options.repository) {
    conditions.push(eq(activities.repository, options.repository));
  }

  if (options.type) {
    conditions.push(eq(activities.type, options.type));
  }

  if (options.fromDate) {
    conditions.push(gte(activities.activityDate, options.fromDate));
  }

  if (options.toDate) {
    conditions.push(lte(activities.activityDate, options.toDate));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Find activities by various criteria
 */
export async function findActivities(
  options: ActivityQueryOptions = {}
): Promise<StoredActivity[]> {
  const db = getDb();
  if (!db || !isConnected()) {
    throw new Error('Database not connected');
  }

  const whereConditions = buildWhereConditions(options);
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const results = await db
    .select()
    .from(activities)
    .where(whereConditions)
    .orderBy(desc(activities.activityDate))
    .limit(limit)
    .offset(offset);

  return results.map(toStoredActivity);
}

/**
 * Find activities by author
 */
export async function findByAuthor(author: string, limit = 100): Promise<StoredActivity[]> {
  return findActivities({ author, limit });
}

/**
 * Find activities by repository
 */
export async function findByRepository(repository: string, limit = 100): Promise<StoredActivity[]> {
  return findActivities({ repository, limit });
}

/**
 * Find activities by date range
 */
export async function findByDateRange(
  fromDate: Date,
  toDate: Date,
  limit = 100
): Promise<StoredActivity[]> {
  return findActivities({ fromDate, toDate, limit });
}

/**
 * Count activities matching criteria
 */
export async function countActivities(
  options: Omit<ActivityQueryOptions, 'limit' | 'offset'> = {}
): Promise<number> {
  const db = getDb();
  if (!db || !isConnected()) {
    throw new Error('Database not connected');
  }

  const whereConditions = buildWhereConditions(options);

  const [result] = await db.select({ count: count() }).from(activities).where(whereConditions);

  return result.count;
}
