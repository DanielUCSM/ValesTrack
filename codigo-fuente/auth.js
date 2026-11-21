'use strict';

const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const pool = require('./db');
const derive = promisify(scrypt);
const roles = Object.freeze({ admin: 'Administrador', operador: 'Operador', cliente: 'Consulta / Cliente' });
const sessions = new Map();
const failures = new Map();
const lifetime = 8 * 60 * 60 * 1000;
const windowMs = 5 * 60 * 1000;

async function findAccount(username, db = pool) {
    const { rows } = await db.query(
        'SELECT usuario, nombre, rol, salt, hash, revision FROM public."USUARIO_APP" WHERE usuario=$1', [username]
    );
    return rows[0];
}
function profile(username, record) {
    return {
        usuario: username, nombre: record.nombre || username,
        rol: record.rol, etiqueta: roles[record.rol],
    };
}

function accountError(status, message) {
    return Object.assign(new Error(message), { status });
}

async function listAccounts() {
    const { rows } = await pool.query('SELECT usuario, nombre, rol FROM public."USUARIO_APP" ORDER BY usuario');
    return rows.map(record => profile(record.usuario, record));
}

function invalidate(username) {
    for (const [id, session] of sessions) if (session.user.usuario === username) sessions.delete(id);
}

async function saveAccount(input, username, actor) {
    const requested = typeof input.usuario === 'string' ? input.usuario.trim().toLowerCase() : '';
    const name = typeof input.nombre === 'string' ? input.nombre.trim() : '';
    const role = input.rol;
    const password = input.contrasena ?? '';
    if (!/^[a-z0-9_]{1,40}$/.test(requested)) throw accountError(422, 'Usa de 1 a 40 letras, números o guiones bajos en el usuario.');
    if (!name || name.length > 100) throw accountError(422, 'Escribe un nombre de hasta 100 caracteres.');
    if (typeof role !== 'string' || !Object.hasOwn(roles, role)) throw accountError(422, 'Selecciona un rol válido.');
    if (typeof password !== 'string' || (password && (password.length < 12 || password.length > 128 || !password.trim()))) {
        throw accountError(422, 'La contraseña debe tener entre 12 y 128 caracteres y no puede estar en blanco.');
    }
    const newPassword = password || (!username ? randomBytes(15).toString('base64url') : '');
    let credentials = null;
    if (newPassword) {
        const salt = randomBytes(16);
        credentials = { salt: salt.toString('hex'), hash: (await derive(newPassword, salt, 64)).toString('hex') };
    }

    const db = await pool.connect();
    let updated;
    try {
        await db.query('BEGIN');
        await db.query('LOCK TABLE public."USUARIO_APP" IN SHARE ROW EXCLUSIVE MODE');
        if ((await findAccount(actor, db))?.rol !== 'admin') {
            throw accountError(403, 'Tu cuenta ya no tiene permisos para administrar usuarios.');
        }
        const existing = username ? await findAccount(username, db) : null;
        if (username && !existing) throw accountError(404, 'La cuenta no existe.');
        if (username !== requested && await findAccount(requested, db)) {
            throw accountError(409, 'Ese nombre de usuario ya está ocupado.');
        }
        if (username === actor && role !== 'admin') {
            throw accountError(409, 'Cambia el rol de esta cuenta desde otra cuenta administradora.');
        }
        updated = { nombre: name, rol: role, ...(credentials || { salt: existing.salt, hash: existing.hash }) };
        const values = [requested, updated.nombre, updated.rol, updated.salt, updated.hash];
        if (username) {
            await db.query(`UPDATE public."USUARIO_APP" SET usuario=$1, nombre=$2, rol=$3,
                salt=$4, hash=$5, revision=DEFAULT WHERE usuario=$6`, [...values, username]);
        } else {
            await db.query(`INSERT INTO public."USUARIO_APP" (usuario, nombre, rol, salt, hash)
                VALUES ($1,$2,$3,$4,$5)`, values);
        }
        await db.query('COMMIT');
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        db.release();
    }
    if (username) invalidate(username);
    return {
        cuenta: profile(requested, updated), contrasena: newPassword || null,
        volver_a_ingresar: username === actor,
    };
}

function token(req) {
    return String(req.headers.cookie || '').match(/(?:^|;\s*)vt_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

async function current(req) {
    const id = token(req);
    const session = sessions.get(id);
    if (!session) return null;
    if (session.expires <= Date.now()) {
        sessions.delete(id);
        return null;
    }
    const account = await findAccount(session.user.usuario);
    if (!account || account.revision !== session.revision) {
        sessions.delete(id);
        return null;
    }
    return session.user;
}

function cookie(res, value, seconds) {
    const secure = process.env.SESSION_SECURE === '1' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `vt_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`);
}

function logout(req, res) {
    sessions.delete(token(req));
    cookie(res, '', 0);
}

async function login(req, res, input) {
    const username = String(input.usuario ?? '').trim().toLowerCase();
    const password = input.contrasena;
    if (!/^[a-z0-9_]{1,40}$/.test(username) || typeof password !== 'string' ||
        password.length > 256 || !password) return { status: 401, error: 'Usuario o contraseña incorrectos.' };

    const now = Date.now();
    const ip = req.socket.remoteAddress;
    for (const [key, attempts] of failures) if (attempts.until <= now) failures.delete(key);
    const attempts = failures.get(ip) ?? { count: 0, until: now + windowMs };
    if (attempts.count >= 12) return { status: 429, error: 'Demasiados intentos. Espera cinco minutos.' };

    attempts.count += 1;
    failures.set(ip, attempts);
    const record = await findAccount(username);
    const actual = await derive(password, Buffer.from(record?.salt || '00'.repeat(16), 'hex'), 64);
    const expected = Buffer.from(record?.hash || '00'.repeat(64), 'hex');
    if (!record || !Object.hasOwn(roles, record.rol) || expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)) {
        return { status: 401, error: 'Usuario o contraseña incorrectos.' };
    }

    // Discard a login if its credentials changed while scrypt was running.
    const latest = await findAccount(username);
    if (!latest || latest.revision !== record.revision) {
        return { status: 401, error: 'La cuenta cambió. Vuelve a iniciar sesión.' };
    }
    failures.delete(ip);
    sessions.delete(token(req));
    for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
    const id = randomBytes(32).toString('hex');
    const user = profile(username, record);
    sessions.set(id, { user, revision: record.revision, expires: now + lifetime });
    cookie(res, id, lifetime / 1000);
    return { status: 200, user };
}

function allowed(user, method, pathname) {
    if (user.rol === 'admin') return true;
    if (['/api/prueba-conexion', '/api/dashboard', '/api/dashboard/detalle'].includes(pathname)) return method === 'GET';
    const vale = /^\/api\/vales(?:\/|$)/.test(pathname);
    if (user.rol === 'cliente') return method === 'GET' && vale;
    if (vale) return !pathname.endsWith('/recuperar');
    return method === 'GET' && (/^\/api\/(?:catalogos|reportes)(?:\/|$)/.test(pathname));
}

module.exports = { allowed, current, login, logout, roles, listAccounts, saveAccount };
