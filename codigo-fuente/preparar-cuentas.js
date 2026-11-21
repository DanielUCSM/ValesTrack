'use strict';

const { readFileSync } = require('node:fs');
const { randomBytes, scryptSync } = require('node:crypto');
const { cargarEntorno } = require('./entorno');
const roles = { admin: 'Administrador', operador: 'Operador', cliente: 'Consulta / Cliente' };

function accountsFrom(file) {
    if (file) {
        const rows = Object.entries(JSON.parse(readFileSync(file, 'utf8'))).map(([usuario, account]) =>
            [usuario, account.nombre || usuario, account.rol, account.salt, account.hash]);
        return { rows };
    }
    const password = randomBytes(18).toString('base64url');
    const salt = randomBytes(16);
    return {
        rows: [['admin', roles.admin, 'admin', salt.toString('hex'), scryptSync(password, salt, 64).toString('hex')]],
        password,
    };
}

async function main(pool) {
    const file = process.argv[2];
    const { rows, password } = accountsFrom(file);
    if (!rows.some(row => row[2] === 'admin')) throw new Error('Se requiere al menos una cuenta administradora.');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE public."USUARIO_APP" IN SHARE ROW EXCLUSIVE MODE');
        const { rowCount } = await client.query('SELECT 1 FROM public."USUARIO_APP" LIMIT 1');
        if (rowCount) throw new Error('La base compartida ya tiene cuentas.');
        for (const row of rows) {
            await client.query('INSERT INTO public."USUARIO_APP" (usuario,nombre,rol,salt,hash) VALUES ($1,$2,$3,$4,$5)', row);
        }
        await client.query('COMMIT');
        if (file) console.log('Cuentas importadas. Conservan sus contraseñas.');
        else console.log('Usuario: admin\nContraseña inicial: ' + password);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function run() {
    cargarEntorno();
    const pool = require('./db');
    try {
        await main(pool);
    } finally {
        await pool.end();
    }
}

run().catch(error => {
    console.error('No se pudieron preparar las cuentas:', error.message);
    process.exitCode = 1;
});
