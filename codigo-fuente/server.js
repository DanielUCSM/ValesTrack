const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const pool = require('./db');
const reports = require('./reportes.json');
const catalogs = require('./public/modulos.json');
const { tipos, unidades } = require('./public/opciones.json');
const auth = require('./auth');
const dashboard = require('./dashboard');
const signatureFields = ['firma_solicita', 'firma_autoriza', 'firma_despacha'];

const files = new Map([
    ['/', ['index.html', 'text/html']],
    ['/styles.css', ['styles.css', 'text/css']],
    ['/logo-vale.png', ['logo-vale.png', 'image/png']],
    ['/logo-marca.png', ['logo-marca.png', 'image/png']],
    ['/vale-documento.js', ['vale-documento.js', 'text/javascript']],
    ['/vales.js', ['vales.js', 'text/javascript']],
    ['/panel.js', ['panel.js', 'text/javascript']],
    ['/app.js', ['app.js', 'text/javascript']],
    ['/opciones.json', ['opciones.json', 'application/json']],
    ['/modulos.json', ['modulos.json', 'application/json']],
]);

function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

async function readJson(req) {
    let length = 0;
    const chunks = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > 2_000_000) {
            req.resume();
            throw httpError(413, 'El vale excede el tamaño admitido.');
        }
        chunks.push(chunk);
    }

    try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
        throw httpError(400, 'El contenido no es JSON válido.');
    }
    throw httpError(400, 'Envíe los datos del vale como un objeto JSON.');
}

async function readCursor(statement, args = []) {
    const client = await pool.connect();
    let discard;
    try {
        await client.query('BEGIN');
        await client.query(statement, args);
        const result = await client.query('FETCH ALL FROM resultado_app');
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            discard = rollbackError;
        }
        throw error;
    } finally {
        client.release(discard);
    }
}

const databaseErrors = new Map([
    ['23505', [409, 'Ya existe un registro con ese identificador, código o folio. Revisa también la papelera.']],
    ['23503', [422, 'Uno de los catálogos seleccionados ya no está disponible.']],
    ['23502', [422, 'Completa todos los campos obligatorios.']],
    ['23514', [422, 'Revisa fechas, cantidades y campos obligatorios.']],
    ['22001', [422, 'Uno de los textos supera la longitud permitida.']],
    ['22003', [422, 'Una cantidad supera el rango permitido.']],
    ['22007', [422, 'Introduce fechas válidas.']],
    ['22008', [422, 'Introduce fechas válidas.']],
    ['22P02', [422, 'Revisa el formato de los campos.']],
    ['22023', [422, 'Introduce entre 1 y 1000 materiales válidos.']],
    ['P0002', [409, 'El vale no existe o está anulado. Actualiza la bandeja.']],
]);

async function validateValeOptions(data, folio) {
    const previous = folio ? (await pool.query(
        'SELECT tipo_salida, firma_solicita, firma_autoriza, firma_despacha FROM public."VALE_SALIDA" WHERE folio_n = $1',
        [folio],
    )).rows[0] : null;
    if (!tipos.includes(data.tipo_salida) && data.tipo_salida !== previous?.tipo_salida) {
        throw httpError(422, 'Selecciona un tipo de salida del listado.');
    }
    const png = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;
    for (const field of signatureFields) {
        const value = data[field];
        if (value == null || value === previous?.[field]) continue;
        if (typeof value !== 'string' || value.length > 125000 || !png.test(value)) {
            throw httpError(422, 'Dibuja la firma en el recuadro. Usa el botón Limpiar para dejarla pendiente.');
        }
    }
}

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname;
        res.setHeader('Cache-Control', 'no-store');
        if (['POST', 'PUT'].includes(req.method) &&
            req.headers['content-type']?.split(';')[0] !== 'application/json') {
            throw httpError(415, 'Envía la solicitud como application/json.');
        }
        if (req.method === 'GET' && files.has(pathname)) {
            const [name, type] = files.get(pathname);
            const content = await readFile(path.join(__dirname, 'public', name));
            res.writeHead(200, { 'Content-Type': type.startsWith('image/') ? type : `${type}; charset=utf-8` });
            return res.end(content);
        }

        if (pathname === '/api/login' && req.method === 'POST') {
            const { status, user, error } = await auth.login(req, res, await readJson(req));
            return json(res, status, user || { error });
        }
        if (pathname === '/api/sesion' && req.method === 'GET') {
            return json(res, 200, { usuario: await auth.current(req) });
        }
        if (pathname === '/api/logout' && req.method === 'POST') {
            auth.logout(req, res);
            return json(res, 200, { ok: true });
        }
        const user = await auth.current(req);
        if (!user) throw httpError(401, 'Inicia sesión para continuar.');
        if (!auth.allowed(user, req.method, pathname)) {
            throw httpError(403, 'Tu perfil no tiene permisos para esta operación.');
        }
        if (req.method === 'GET' && pathname === '/api/dashboard') {
            const dias = Number(url.searchParams.get('dias') ?? 90);
            if (![7, 30, 90, 365].includes(dias)) throw httpError(422, 'Selecciona un período válido.');
            return json(res, 200, await dashboard(pool, user.rol, dias));
        }
        if (req.method === 'GET' && pathname === '/api/dashboard/detalle') {
            const dias = Number(url.searchParams.get('dias') ?? 90);
            const start = url.searchParams.get('inicio');
            const end = url.searchParams.get('fin');
            if (![7, 30, 90, 365].includes(dias) || [start, end].some(date => date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
                || (start && end && start > end)) throw httpError(422, 'Selecciona un período válido.');
            return json(res, 200, await dashboard.details(pool, user.rol, dias, url.searchParams.get('tipo'), start, end));
        }
        if (pathname === '/api/usuarios') {
            if (req.method === 'GET') return json(res, 200, await auth.listAccounts());
            if (req.method === 'POST') return json(res, 201, await auth.saveAccount(await readJson(req), null, user.usuario));
        }
        const accountRoute = pathname.match(/^\/api\/usuarios\/([a-z0-9_]{1,40})$/);
        if (req.method === 'PUT' && accountRoute) {
            return json(res, 200, await auth.saveAccount(await readJson(req), accountRoute[1], user.usuario));
        }
        if (req.method === 'GET' && pathname === '/api/auditoria') {
            const before = url.searchParams.get('antes');
            if (before !== null && !/^\d{1,18}$/.test(before)) {
                throw httpError(400, 'El cursor de auditoría no es válido.');
            }
            const result = await pool.query(`
                SELECT id, tabla, accion, registro, detalle, fecha_hora
                FROM public."AUDITORIA_LOG"
                WHERE ($1::bigint IS NULL OR id < $1::bigint)
                ORDER BY id DESC LIMIT 100
            `, [before]);
            return json(res, 200, result.rows);
        }

        const catalogRoute = pathname.match(/^\/api\/catalogos\/([A-Z]+)(?:\/([^/]+))?(?:\/(inactivar|recuperar))?$/);
        if (catalogRoute && Object.hasOwn(catalogs, catalogRoute[1])) {
            const [, table, rawKey, transition] = catalogRoute;
            const { clave: keyColumn } = catalogs[table];
            const key = rawKey ? decodeURIComponent(rawKey) : null;
            if (req.method === 'GET' && !key) {
                // Tabla y columna proceden exclusivamente de la lista local.
                const { rows } = await pool.query(`SELECT * FROM public."${table}" ORDER BY "${keyColumn}"`);
                return json(res, 200, rows);
            }
            const creating = req.method === 'POST' && !key;
            const editing = req.method === 'PUT' && key && !transition;
            const changing = req.method === 'POST' && key && transition;
            if (creating || editing || changing) {
                const data = changing ? {} : await readJson(req);
                if (creating && typeof data[keyColumn] === 'string') data[keyColumn] = data[keyColumn].trim();
                if (table === 'PRODUCTO' && !changing && !unidades.some(([key]) => key === data.unidad)) {
                    throw httpError(422, 'Selecciona una unidad del listado.');
                }
                await pool.query('CALL public.vt_catalogo($1,$2,$3,$4::jsonb)',
                    [table, creating ? 'crear' : editing ? 'editar' : transition, key, data]);
                return json(res, creating ? 201 : 200, { ok: true });
            }
        }
        if (req.method === 'GET' && pathname === '/api/prueba-conexion') {
            await pool.query('SELECT 1');
            return json(res, 200, { estado: 'CONEXIÓN EXITOSA A POSTGRESQL' });
        }
        if (req.method === 'GET' && pathname === '/api/reportes') {
            return json(res, 200, reports);
        }

        const report = pathname.match(/^\/api\/reportes\/(\d+)$/);
        if (req.method === 'GET' && report && reports.some(r => r.id === Number(report[1]))) {
            const { rows, fields } = await readCursor(
                "CALL public.ejecutar_reporte($1::integer, 'resultado_app')", [report[1]]
            );
            return json(res, 200, { columns: fields.map(f => f.name), rows });
        }

        if (pathname === '/api/vales') {
            if (req.method === 'GET') {
                const { rows } = await readCursor(
                    "CALL public.consultar_vales(NULL, 'resultado_app')"
                );
                return json(res, 200, user.rol === 'cliente' ? rows.filter(row => row.estado !== 'Anulado') : rows);
            }
            if (req.method === 'POST') {
                const data = await readJson(req);
                if (typeof data.folio_n !== 'string' || !data.folio_n.trim() ||
                    data.folio_n.trim().includes('/')) {
                    throw httpError(422, 'Introduce un folio válido sin barras.');
                }
                data.folio_n = data.folio_n.trim();
                await validateValeOptions(data);
                await pool.query('CALL public.guardar_vale($1::jsonb, false)', [data]);
                return json(res, 201, { folio_n: data.folio_n });
            }
        }

        const vale = pathname.match(/^\/api\/vales\/([^/]+)(\/(?:anular|recuperar|entregar))?$/);
        if (vale) {
            const folio = decodeURIComponent(vale[1]);
            if (req.method === 'POST' && vale[2]) {
                if (vale[2] === '/recuperar') {
                    await pool.query('CALL public.recuperar_vale($1::text)', [folio]);
                } else {
                    const data = await readJson(req);
                    if (vale[2] === '/entregar') {
                        await pool.query('CALL public.vt_entregar($1::text, $2::date)', [folio, data.fecha ?? null]);
                    } else {
                        await pool.query('CALL public.vt_anular($1::text, $2::text)', [folio,
                            typeof data.motivo === 'string' ? data.motivo.trim() : null]);
                    }
                }
                return json(res, 200, { folio_n: folio });
            }
            if (!vale[2] && req.method === 'GET') {
                const { rows } = await readCursor(
                    "CALL public.consultar_vales($1::text, 'resultado_app')", [folio]
                );
                if (!rows.length || (user.rol === 'cliente' && rows[0].anulado_en)) {
                    throw httpError(404, 'No se encontró el vale.');
                }
                const detail = rows[0];
                const display = await pool.query(`
                    SELECT a.nombre AS area, p.nombre AS proyecto,
                        concat_ws(' ', s.primer_nombre, s.segundo_nombre, s.apellido_paterno, s.apellido_materno) AS solicitante,
                        concat_ws(' ', d.primer_nombre, d.segundo_nombre, d.apellido_paterno, d.apellido_materno) AS despacho,
                        concat_ws(' ', u.primer_nombre, u.segundo_nombre, u.apellido_paterno, u.apellido_materno) AS autorizador
                    FROM public."VALE_SALIDA" v LEFT JOIN public."AREA" a USING (id_area)
                    LEFT JOIN public."PROYECTO" p USING (id_proyecto)
                    LEFT JOIN public."EMPLEADO" s ON s.id_empleado = v.id_empleado_solicita
                    LEFT JOIN public."EMPLEADO" d ON d.id_empleado = v.id_empleado_despacha
                    LEFT JOIN public."EMPLEADO" u ON u.id_empleado = v.id_empleado_autoriza
                    WHERE v.folio_n = $1
                `, [folio]);
                const products = await pool.query(`
                    SELECT codigo_producto, descripcion_material, unidad FROM public."PRODUCTO"
                    WHERE codigo_producto = ANY($1::text[])
                `, [detail.items.map(item => item.codigo_producto)]);
                const labels = new Map(products.rows.map(row => [row.codigo_producto, row]));
                detail.rotulos = display.rows[0] || {};
                detail.items = detail.items.map(item => ({ ...item, ...labels.get(item.codigo_producto) }));
                if (user.rol === 'cliente') {
                    for (const field of signatureFields) delete detail[field];
                    detail.items = detail.items.filter(item => item.activo);
                }
                return json(res, 200, detail);
            }
            if (!vale[2] && req.method === 'PUT') {
                const data = await readJson(req);
                data.folio_n = folio;
                await validateValeOptions(data, folio);
                await pool.query('CALL public.guardar_vale($1::jsonb, true)', [data]);
                return json(res, 200, { folio_n: folio });
            }
        }

        return json(res, 404, { error: 'Ruta no encontrada.' });
    } catch (error) {
        if (error instanceof URIError) return json(res, 400, { error: 'URL inválida.' });
        if (error.status) return json(res, error.status, { error: error.message });
        if (error.code === 'PVT01') return json(res, 422, { error: error.message });
        if (error.code === 'P0002') return json(res, 409, { error: error.message });
        const known = databaseErrors.get(error.code);
        if (known) return json(res, known[0], { error: known[1] });
        console.error(error);
        return json(res, 500, { error: 'No se pudo completar la operación.' });
    }
}).listen(Number(process.env.PORT || 3000), process.env.APP_HOST || '127.0.0.1', () => {
    console.log(`Servidor disponible en http://127.0.0.1:${server.address().port}`);
});

module.exports = server;
