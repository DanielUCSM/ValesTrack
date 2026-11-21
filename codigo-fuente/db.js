'use strict';

const { Pool } = require('pg');
const { readFileSync } = require('node:fs');

const localHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

function connectionOptions() {
    const { DATABASE_URL, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT, DB_SSL, DB_SSL_CA } = process.env;
    if (DATABASE_URL) {
        const url = URL.parse(DATABASE_URL);
        if (!url?.hostname || !['postgres:', 'postgresql:'].includes(url.protocol)) {
            throw new Error('DATABASE_URL debe ser una URL válida de PostgreSQL.');
        }
        const host = url.searchParams.get('host') || url.hostname;
        if (!localHosts.has(host)) url.searchParams.set('sslmode', 'verify-full');
        return {
            connectionString: url.href,
            enableChannelBinding: url.searchParams.get('channel_binding') !== 'disable',
        };
    }

    if (DB_SSL === '0' && !localHosts.has(DB_HOST)) {
        throw new Error('Una base remota requiere TLS. Usa DB_SSL=1 y configura la CA si corresponde.');
    }
    return {
        user: DB_USER,
        host: DB_HOST,
        database: DB_NAME,
        password: DB_PASSWORD,
        port: Number(DB_PORT || 5432),
        ssl: DB_SSL === '0' ? false : {
            rejectUnauthorized: true,
            ...(DB_SSL_CA ? { ca: readFileSync(DB_SSL_CA, 'utf8') } : {}),
        },
    };
}

module.exports = new Pool({ ...connectionOptions(), connectionTimeoutMillis: 5000 });
