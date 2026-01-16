import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';
import dns from 'node:dns';

// Force usage of IPv4 if available, as some environments fail with IPv6 (ENETUNREACH)
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const { Pool } = pg;

// Global connection state
let pool: pg.Pool | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function initDb() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set');
    }

    // Configure pool for Neon and other serverless Postgres providers
    // Neon supports both direct and pooled connections
    const poolConfig: pg.PoolConfig = {
        connectionString,
        // SSL is required for Neon
        ssl: connectionString.includes('neon.tech') 
            ? { rejectUnauthorized: false } 
            : undefined,
        // Connection pool settings optimized for serverless
        max: parseInt(process.env.DB_POOL_MAX || '10', 10),
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '10000', 10),
    };

    pool = new Pool(poolConfig);

    db = drizzle(pool, { schema });
    return db;
}

export function getDb() {
    if (!db) {
        return initDb();
    }
    return db;
}

export function isConnected(): boolean {
    return !!db;
}

export async function closeDb() {
    if (pool) {
        await pool.end();
        pool = undefined;
        db = undefined;
    }
}

// Compatibility exports
export const isDatabaseConfigured = (): boolean => {
    return !!process.env.DATABASE_URL;
};

export const initDatabase = async (): Promise<boolean> => {
    try {
        const db = getDb();
        // Verify connection
        await db.execute(sql`SELECT 1`);
        return true;
    } catch (e) {
        return false;
    }
}

export const closeDatabase = closeDb;
