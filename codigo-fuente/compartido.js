'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { cargarEntorno } = require('./entorno');

const windows = process.platform === 'win32';
const root = __dirname;
const home = windows ? path.join(process.env.LOCALAPPDATA, 'ValesTrack-Compartido') : root;
const config = process.env.VALESTRACK_SHARED_CONFIG || path.join(home, 'conexion.env');
let pool;

function startProcess(executable, args) {
    const process = spawn(executable, args, { stdio: 'ignore', detached: true, windowsHide: true });
    process.on('error', () => {});
    process.unref();
}

function openBrowser(url) {
    if (process.env.VALESTRACK_NO_BROWSER === '1') return;
    if (windows) {
        const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
            .filter(Boolean).map(folder => path.join(folder,'Microsoft','Edge','Application','msedge.exe'))
            .find(file => fs.existsSync(file));
        if (edge) startProcess(edge, ['--app=' + url]);
        else startProcess(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'),
            ['url.dll,FileProtocolHandler', url]);
    } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        startProcess('xdg-open', [url]);
    }
}

function readConfig() {
    const explicit = process.env.VALESTRACK_SHARED_CONFIG;
    const hasLegacyEnv = () => ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].every(key => process.env[key]);
    const loaded = (!explicit || fs.existsSync(explicit)) && cargarEntorno();
    const supplied = !explicit && (process.env.DATABASE_URL || hasLegacyEnv());
    if (!loaded && !supplied) {
        loadSharedConfig();
    }

    const { DATABASE_URL, PORT } = process.env;
    if (!DATABASE_URL && !hasLegacyEnv()) {
        throw new Error('Configura DATABASE_URL o completa DB_HOST, DB_NAME, DB_USER y DB_PASSWORD.');
    }
    if (PORT !== undefined && (!/^\d+$/.test(PORT) || Number(PORT) > 65535)) {
        throw new Error('PORT debe ser un número entre 0 y 65535.');
    }
    if (windows) process.env.APP_HOST = '127.0.0.1';
    process.env.PORT ??= '0';
}

function loadSharedConfig() {
    if (!fs.existsSync(config)) {
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.copyFileSync(path.join(root, '.env.example'), config, fs.constants.COPYFILE_EXCL);
        if (windows) startProcess(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe'), [config]);
        throw new Error('Se creó ' + config + '. Configura la conexión compartida y vuelve a abrir ValesTrack.');
    }
    process.loadEnvFile(config);
}

async function main() {
    readConfig();
    pool = require('./db');
    pool.on('error', error => console.error('PostgreSQL: ' + error.message));
    const { rows: [status] } = await pool.query(`
        SELECT to_regclass('public."VALE_SALIDA"') IS NOT NULL AS vales,
               to_regclass('public."USUARIO_APP"') IS NOT NULL AS cuentas,
               to_regprocedure('public.vt_entregar(text,date)') IS NOT NULL AS estados
    `);
    if (!status.vales || !status.estados || !status.cuentas) {
        throw new Error('Falta preparar la base compartida. Revisa la guía de configuración.');
    }
    const { rowCount } = await pool.query('SELECT 1 FROM public."USUARIO_APP" WHERE rol=\'admin\' LIMIT 1');
    if (!rowCount) throw new Error('Prepara la cuenta inicial en PostgreSQL antes de abrir ValesTrack.');
    const server = require('./server');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port;
    console.log('ValesTrack: ' + url);
    console.log('El aplicativo corre en este equipo. Los datos están en el servidor PostgreSQL configurado.');
    openBrowser(url);
    let stopping = false;
    async function stop() {
        if (stopping) return;
        stopping = true;
        const closed = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
        await closed;
        await pool.end();
        process.exit(0);
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
}

main().catch(async error => {
    console.error('Inicio de ValesTrack: ' + error.message);
    if (pool) await pool.end().catch(() => {});
    process.exitCode = 1;
});
