import { eq, and, gte, lte, desc, count } from 'drizzle-orm';
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
 * Convert UserActivity to NewActivity for database insertion
 */
function toNewActivity(activity: UserActivity): NewActivity {
  return {
    type: activity.type,
    author: activity.author,
    activityDate: new Date(activity.date),
    repository: activity.repository,
    url: activity.url || null,
    title: activity.title || null,
    description: activity.description || null,
    meta: activity.meta || {},
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
 * Save a single activity to the database
 */
export async function saveActivity(activity: UserActivity): Promise<string> {
  const db = getDb();
  if (!db || !isConnected()) {
    throw new Error('Database not connected');
  }

  const [result] = await db
    .insert(activities)
    .values(toNewActivity(activity))
    .returning({ id: activities.id });

  return result.id;
}

/**
 * Save multiple activities in a batch (uses transaction)
 */
export async function saveActivities(activitiesList: UserActivity[]): Promise<string[]> {
  const db = getDb();
  if (!db || !isConnected()) {
    throw new Error('Database not connected');
  }

  if (activitiesList.length === 0) {
    return [];
  }

  const newActivities = activitiesList.map(toNewActivity);
  const results = await db
    .insert(activities)
    .values(newActivities)
    .returning({ id: activities.id });

  return results.map((r) => r.id);
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
