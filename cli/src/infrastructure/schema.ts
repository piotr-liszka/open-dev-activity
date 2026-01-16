import { pgTable, uuid, varchar, text, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';

// Activities table for storing all user activities from CLI commands
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uniqueKey: varchar('unique_key', { length: 500 }).notNull(), // Unique identifier for upsert logic
    type: varchar('type', { length: 50 }).notNull(),
    author: varchar('author', { length: 255 }).notNull(),
    activityDate: timestamp('activity_date', { withTimezone: true }).notNull(),
    repository: varchar('repository', { length: 500 }).notNull(),
    url: text('url'),
    title: text('title'),
    description: text('description'),
    meta: jsonb('meta').default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('uq_activities_unique_key').on(table.uniqueKey), // Unique constraint for upsert
    index('idx_activities_type').on(table.type),
    index('idx_activities_author').on(table.author),
    index('idx_activities_date').on(table.activityDate),
    index('idx_activities_repository').on(table.repository),
    index('idx_activities_created_at').on(table.createdAt),
    index('idx_activities_author_date').on(table.author, table.activityDate),
    index('idx_activities_repo_date').on(table.repository, table.activityDate),
    index('idx_activities_unique_key').on(table.uniqueKey),
  ]
);

// Type for inserting a new activity
export type NewActivity = typeof activities.$inferInsert;

// Type for selecting an activity
export type Activity = typeof activities.$inferSelect;
