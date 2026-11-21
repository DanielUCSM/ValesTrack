'use strict';

const overview = `
    WITH limites AS (
        SELECT (current_timestamp AT TIME ZONE 'America/Lima')::date AS hoy,
               $1::integer AS dias
    ), ventana AS (
        SELECT hoy, hoy - (dias - 1) AS inicio, dias FROM limites
    ), vales AS (
        SELECT v.* FROM public."VALE_SALIDA" v, ventana w WHERE v.fecha_emision BETWEEN w.inicio AND w.hoy
    ), activos AS (
        SELECT * FROM vales WHERE anulado_en IS NULL
    ), detalles AS (
        SELECT d.* FROM public.detalles_vigentes d JOIN activos a USING (folio_n)
    ), dias AS (
        SELECT w.inicio + n AS fecha, n / (CASE WHEN w.dias > 90 THEN 30 WHEN w.dias > 30 THEN 7 ELSE 1 END) AS grupo
        FROM ventana w CROSS JOIN LATERAL generate_series(0, w.dias - 1) n
    )
    SELECT w.inicio::text AS inicio, w.hoy::text AS fin,
      (SELECT count(*)::int FROM activos) AS vigentes,
      (SELECT count(*)::int FROM activos WHERE fecha_entrega IS NULL) AS pendientes,
      (SELECT count(*)::int FROM activos WHERE fecha_entrega IS NOT NULL) AS entregados,
      (SELECT count(*)::int FROM vales WHERE anulado_en IS NOT NULL) AS anulados,
      (SELECT count(*)::int FROM activos WHERE fecha_entrega IS NULL AND w.hoy - fecha_emision >= 7) AS pendientes_7,
      (SELECT count(*)::int FROM detalles) AS lineas,
      (SELECT count(*)::int FROM detalles WHERE cantidad_autorizada > cantidad_entregada) AS lineas_pendientes,
      (SELECT round(avg(fecha_entrega - fecha_emision)::numeric, 1) FROM activos WHERE fecha_entrega IS NOT NULL) AS demora,
      (SELECT coalesce(jsonb_agg(f ORDER BY f.inicio), '[]') FROM (
        SELECT min(d.fecha)::text AS inicio, max(d.fecha)::text AS fin,
               count(a.folio_n)::int AS total, count(a.fecha_entrega)::int AS entregados
        FROM dias d LEFT JOIN activos a ON a.fecha_emision = d.fecha GROUP BY d.grupo
      ) f) AS tendencia,
      (SELECT coalesce(jsonb_agg(f), '[]') FROM (
        SELECT a.folio_n, a.fecha_emision::text, a.fecha_entrega::text, p.nombre AS proyecto,
            r.nombre AS area, CASE WHEN a.fecha_entrega IS NULL THEN 'Pendiente' ELSE 'Entregado' END AS estado
        FROM activos a LEFT JOIN public."PROYECTO" p USING (id_proyecto)
        LEFT JOIN public."AREA" r USING (id_area)
        ORDER BY a.fecha_emision DESC, a.folio_n DESC LIMIT 8
      ) f) AS recientes,
      (SELECT coalesce(jsonb_agg(f), '[]') FROM (
        SELECT a.folio_n, r.nombre AS area, p.nombre AS proyecto, a.fecha_emision::text,
               w.hoy - a.fecha_emision AS dias
        FROM activos a LEFT JOIN public."AREA" r USING (id_area)
        LEFT JOIN public."PROYECTO" p USING (id_proyecto)
        WHERE a.fecha_entrega IS NULL ORDER BY a.fecha_emision, a.folio_n LIMIT 8
      ) f) AS cola,
      (SELECT coalesce(jsonb_agg(f), '[]') FROM (
        SELECT r.nombre, count(*)::int AS total, count(*) FILTER (WHERE a.fecha_entrega IS NULL)::int AS pendientes
        FROM activos a JOIN public."AREA" r USING (id_area)
        GROUP BY r.id_area, r.nombre ORDER BY total DESC, r.nombre LIMIT 8
      ) f) AS areas,
      (SELECT coalesce(jsonb_agg(f), '[]') FROM (
        SELECT p.nombre, count(*)::int AS total, count(*) FILTER (WHERE a.fecha_entrega IS NULL)::int AS pendientes
        FROM activos a JOIN public."PROYECTO" p USING (id_proyecto)
        GROUP BY p.id_proyecto, p.nombre ORDER BY total DESC, p.nombre LIMIT 8
      ) f) AS proyectos,
      (SELECT coalesce(jsonb_agg(f), '[]') FROM (
        SELECT p.codigo_producto AS codigo, p.descripcion_material AS material, p.unidad,
               count(DISTINCT d.folio_n)::int AS vales, sum(d.cantidad_autorizada - d.cantidad_entregada) AS pendiente
        FROM detalles d JOIN public."PRODUCTO" p USING (codigo_producto)
        GROUP BY p.codigo_producto, p.descripcion_material, p.unidad
        ORDER BY vales DESC, codigo LIMIT 8
      ) f) AS materiales
    FROM ventana w
`;

const administration = `
    SELECT
        (SELECT count(*)::int FROM public."EMPLEADO" WHERE activo) AS empleados,
        (SELECT count(*)::int FROM public."PRODUCTO" WHERE activo) AS productos,
        (SELECT count(*)::int FROM public."AREA" WHERE activo) AS areas_activas,
        (SELECT count(*)::int FROM public."PROYECTO" WHERE activo) AS proyectos_activos,
        (SELECT count(*)::int FROM public."VALE_SALIDA" WHERE anulado_en IS NOT NULL) AS papelera,
        (SELECT coalesce(jsonb_agg(f), '[]') FROM (
            SELECT accion, tabla, registro, fecha_hora FROM public."AUDITORIA_LOG" ORDER BY id DESC LIMIT 8
        ) f) AS actividad
`;

module.exports = async function dashboard(pool, role, days) {
    const { rows: [data] } = await pool.query(overview, [days]);
    const { inicio, fin, vigentes, pendientes, entregados, tendencia, recientes } = data;
    const summary = { inicio, fin, vigentes, pendientes, entregados, tendencia, recientes };
    if (role === 'cliente') {
        // The dashboard exposes the same scope as the client's active-vale list.
        return summary;
    }
    const operations = {
        ...summary, pendientes_7: data.pendientes_7, lineas: data.lineas,
        lineas_pendientes: data.lineas_pendientes, demora: data.demora, cola: data.cola,
        areas: data.areas, proyectos: data.proyectos, materiales: data.materiales,
    };
    if (role === 'operador') return operations;
    const { rows: [admin] } = await pool.query(administration);
    return { ...operations, ...admin, anulados: data.anulados };
};

const filters = new Map([
    ['vigentes', 'v.anulado_en IS NULL'],
    ['pendientes', 'v.anulado_en IS NULL AND v.fecha_entrega IS NULL'],
    ['entregados', 'v.anulado_en IS NULL AND v.fecha_entrega IS NOT NULL'],
    ['antiguos', 'v.anulado_en IS NULL AND v.fecha_entrega IS NULL AND w.hoy - v.fecha_emision >= 7'],
    ['anulados', 'v.anulado_en IS NOT NULL'],
    ['papelera', 'v.anulado_en IS NOT NULL'],
]);
const operational = new Set(['antiguos', 'lineas', 'areas', 'proyectos', 'materiales']);
const administrationOnly = new Set(['anulados', 'papelera']);
const periods = new Set(['vigentes', 'pendientes', 'entregados']);

module.exports.details = async function dashboardDetails(pool, role, days, type, start, end) {
    if (!periods.has(type) && !operational.has(type) && !administrationOnly.has(type)) {
        throw Object.assign(new Error('Indicador no disponible.'), { status: 404 });
    }
    if ((role === 'cliente' && !periods.has(type)) || (role !== 'admin' && administrationOnly.has(type))) {
        throw Object.assign(new Error('Tu perfil no tiene acceso a este indicador.'), { status: 403 });
    }
    const window = `WITH ventana AS (
        SELECT (current_timestamp AT TIME ZONE 'America/Lima')::date AS hoy, $1::integer AS dias
    ), elegibles AS (
        SELECT v.* FROM public."VALE_SALIDA" v CROSS JOIN ventana w
        WHERE (${type === 'papelera' ? 'true' : 'v.fecha_emision BETWEEN w.hoy - (w.dias - 1) AND w.hoy'})
          AND ($2::date IS NULL OR v.fecha_emision >= $2::date)
          AND ($3::date IS NULL OR v.fecha_emision <= $3::date)
          AND ${filters.get(type) || 'v.anulado_en IS NULL'}
    )`;
    const operationalQueries = {
        lineas: `SELECT v.folio_n, d.n_item, p.descripcion_material AS material, p.unidad,
                  d.cantidad_autorizada - d.cantidad_entregada AS saldo
                 FROM elegibles v JOIN public.detalles_vigentes d USING (folio_n)
                 JOIN public."PRODUCTO" p USING (codigo_producto)
                 WHERE d.cantidad_autorizada > d.cantidad_entregada ORDER BY v.fecha_emision, d.folio_n, d.n_item`,
        areas: `SELECT a.nombre, count(*)::int AS total, count(*) FILTER (WHERE v.fecha_entrega IS NULL)::int AS pendientes
                FROM elegibles v JOIN public."AREA" a USING (id_area) GROUP BY a.id_area, a.nombre ORDER BY total DESC, a.nombre`,
        proyectos: `SELECT p.nombre, count(*)::int AS total, count(*) FILTER (WHERE v.fecha_entrega IS NULL)::int AS pendientes
                FROM elegibles v JOIN public."PROYECTO" p USING (id_proyecto) GROUP BY p.id_proyecto, p.nombre ORDER BY total DESC, p.nombre`,
        materiales: `SELECT p.codigo_producto AS codigo, p.descripcion_material AS material, p.unidad,
                    count(DISTINCT d.folio_n)::int AS vales, sum(d.cantidad_autorizada - d.cantidad_entregada) AS saldo
                  FROM elegibles v JOIN public.detalles_vigentes d USING (folio_n)
                  JOIN public."PRODUCTO" p USING (codigo_producto)
                  GROUP BY p.codigo_producto, p.descripcion_material, p.unidad ORDER BY vales DESC, codigo`,
    };
    const list = `SELECT v.folio_n, v.fecha_emision::text, v.fecha_entrega::text,
               a.nombre AS area, p.nombre AS proyecto,
               CASE WHEN v.anulado_en IS NOT NULL THEN 'Anulado'
                    WHEN v.fecha_entrega IS NOT NULL THEN 'Entregado' ELSE 'Pendiente' END AS estado,
               v.fecha_entrega - v.fecha_emision AS dias
        FROM elegibles v LEFT JOIN public."AREA" a USING (id_area)
        LEFT JOIN public."PROYECTO" p USING (id_proyecto)
        ORDER BY v.fecha_emision ${type === 'antiguos' ? 'ASC' : 'DESC'}, v.folio_n`;
    const { rows } = await pool.query(window + (Object.hasOwn(operationalQueries, type) ? operationalQueries[type] : list),
        [days, start, end]);
    return rows;
};
