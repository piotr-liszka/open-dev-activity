import pg from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { logInfo } from '../logger.js';
import chalk from 'chalk';
import * as schema from './schema.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

/**
 * Get database configuration from environment variables
 */
export function getDatabaseConfig(): DatabaseConfig | null {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return { connectionString };
  }

  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : undefined;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB;

  if (host && user && password && database) {
    return { host, port: port || 5432, user, password, database };
  }

  return null;
}

/**
 * Check if database is configured
 */
export function isDatabaseConfigured(): boolean {
  return getDatabaseConfig() !== null;
}

/**
 * Initialize database connection pool and Drizzle ORM
 */
export async function initDatabase(): Promise<boolean> {
  const config = getDatabaseConfig();

  if (!config) {
    logInfo(chalk.yellow('Database not configured. Activities will not be persisted.'));
    return false;
  }

  try {
    pool = new Pool({
      ...config,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    // Initialize Drizzle ORM
    db = drizzle(pool, { schema });

    logInfo(chalk.green('Database connection established'));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logInfo(
      chalk.yellow(`Database connection failed: ${message}. Activities will not be persisted.`)
    );
    pool = null;
    db = null;
    return false;
  }
}

/**
 * Get the database pool instance
 */
export function getPool(): pg.Pool | null {
  return pool;
}

/**
 * Get the Drizzle database instance
 */
export function getDb(): NodePgDatabase<typeof schema> | null {
  return db;
}

/**
 * Execute a raw query (for migrations and custom queries)
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool.query<T>(text, params);
}

/**
 * Execute a query with a transaction
 */
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!pool) {
    throw new Error('Database not initialized');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close database connection pool
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    logInfo(chalk.gray('Database connection closed'));
  }
}

/**
 * Check if database is connected
 */
export function isConnected(): boolean {
  return pool !== null && db !== null;
}
