import { startLocalServer } from './app.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const port = Number(process.env.PORT || 10000);
const dbPath = process.env.DATABASE_PATH || './data/bfia-cbt.db';
const secureCookies = process.env.COOKIE_SECURE === 'true';
await mkdir(dirname(dbPath), { recursive: true });
const server = await startLocalServer({ dbPath, host: '0.0.0.0', port, secureCookies });
console.log(`BFIA CBT web server listening on ${server.baseUrl}`);
