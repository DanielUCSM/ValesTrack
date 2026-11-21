ALTER TABLE public."VALE_SALIDA" ADD COLUMN IF NOT EXISTS anulado_en timestamptz;

CREATE OR REPLACE FUNCTION public.validar_vale()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.fecha_entrega < NEW.fecha_emision THEN
        RAISE EXCEPTION 'La entrega no puede ser anterior a la emisión.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_detalle_vale()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF 'NaN'::numeric IN (NEW.cantidad_solicitada, NEW.cantidad_autorizada, NEW.cantidad_entregada)
       OR NEW.cantidad_entregada > NEW.cantidad_autorizada OR
       NEW.cantidad_autorizada > NEW.cantidad_solicitada THEN
        RAISE EXCEPTION 'Ítem %: se requiere entregada ≤ autorizada ≤ solicitada.', NEW.n_item
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_vale ON public."VALE_SALIDA";
CREATE TRIGGER validar_vale BEFORE INSERT OR UPDATE OF fecha_emision, fecha_entrega
ON public."VALE_SALIDA" FOR EACH ROW EXECUTE FUNCTION public.validar_vale();

DROP TRIGGER IF EXISTS validar_detalle_vale ON public."VALE_SALIDA_DETALLE";
CREATE TRIGGER validar_detalle_vale BEFORE INSERT OR UPDATE
ON public."VALE_SALIDA_DETALLE" FOR EACH ROW EXECUTE FUNCTION public.validar_detalle_vale();

CREATE OR REPLACE PROCEDURE public.guardar_vale(p_datos jsonb, p_editar boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    datos public."VALE_SALIDA"%ROWTYPE;
BEGIN
    datos := jsonb_populate_record(NULL::public."VALE_SALIDA", p_datos);
    IF jsonb_typeof(p_datos->'items') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Envíe una lista de materiales.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_datos->'items') NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'El vale debe tener entre 1 y 1000 ítems.' USING ERRCODE = '22023';
    END IF;

    IF p_editar THEN
        UPDATE public."VALE_SALIDA"
        SET fecha_emision = datos.fecha_emision, fecha_entrega = datos.fecha_entrega,
            tipo_salida = datos.tipo_salida, motivo = datos.motivo, id_area = datos.id_area,
            id_proyecto = datos.id_proyecto, id_empleado_despacha = datos.id_empleado_despacha,
            id_empleado_solicita = datos.id_empleado_solicita,
            id_empleado_autoriza = datos.id_empleado_autoriza,
            firma_autoriza = datos.firma_autoriza, firma_despacha = datos.firma_despacha,
            firma_solicita = datos.firma_solicita
        WHERE folio_n = datos.folio_n AND anulado_en IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'El vale no existe o está anulado.' USING ERRCODE = 'P0002';
        END IF;
        DELETE FROM public."VALE_SALIDA_DETALLE" WHERE folio_n = datos.folio_n;
    ELSE
        datos.anulado_en := NULL;
        INSERT INTO public."VALE_SALIDA" SELECT (datos).*;
    END IF;

    INSERT INTO public."VALE_SALIDA_DETALLE"
        (folio_n, n_item, codigo_producto, cantidad_solicitada, cantidad_entregada,
         cantidad_autorizada, observaciones)
    SELECT datos.folio_n, item.orden, item.valor->>'codigo_producto',
           (item.valor->>'cantidad_solicitada')::numeric,
           (item.valor->>'cantidad_entregada')::numeric,
           (item.valor->>'cantidad_autorizada')::numeric,
           item.valor->>'observaciones'
    FROM jsonb_array_elements(p_datos->'items') WITH ORDINALITY AS item(valor, orden);
END;
$$;

CREATE OR REPLACE PROCEDURE public.anular_vale(p_folio text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public."VALE_SALIDA" SET anulado_en = clock_timestamp()
    WHERE folio_n = p_folio AND anulado_en IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El vale no existe o ya está anulado.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

REVOKE ALL ON PROCEDURE public.guardar_vale(jsonb, boolean), public.anular_vale(text) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE public.guardar_vale(jsonb, boolean), public.anular_vale(text) TO app_almacen;

CREATE OR REPLACE VIEW public.vales_vigentes AS
    SELECT * FROM public."VALE_SALIDA" WHERE anulado_en IS NULL;
CREATE OR REPLACE VIEW public.detalles_vigentes AS
    SELECT d.* FROM public."VALE_SALIDA_DETALLE" d
    JOIN public.vales_vigentes v USING (folio_n);
GRANT SELECT ON public.vales_vigentes, public.detalles_vigentes TO app_almacen;

CREATE OR REPLACE PROCEDURE public.consultar_vales(p_folio text, INOUT resultado refcursor)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_folio IS NULL THEN
        OPEN resultado FOR
            SELECT v.folio_n, v.fecha_emision::text, v.fecha_entrega::text, v.tipo_salida,
                   a.nombre AS area, p.nombre AS proyecto,
                   concat_ws(' ', e.primer_nombre, e.apellido_paterno) AS solicitante,
                   count(d.n_item)::int AS total_items,
                   CASE WHEN v.anulado_en IS NOT NULL THEN 'Anulado'
                        WHEN v.fecha_entrega IS NOT NULL THEN 'Entregado'
                        ELSE 'Pendiente' END AS estado
            FROM public."VALE_SALIDA" v
            JOIN public."AREA" a ON a.id_area = v.id_area
            JOIN public."PROYECTO" p ON p.id_proyecto = v.id_proyecto
            JOIN public."EMPLEADO" e ON e.id_empleado = v.id_empleado_solicita
            LEFT JOIN public."VALE_SALIDA_DETALLE" d ON d.folio_n = v.folio_n
            GROUP BY v.folio_n, a.nombre, p.nombre, e.primer_nombre, e.apellido_paterno
            ORDER BY v.fecha_emision DESC, v.folio_n DESC;
    ELSE
        OPEN resultado FOR
            SELECT v.*, v.fecha_emision::text AS emision_iso, v.fecha_entrega::text AS entrega_iso,
                   COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.n_item)
                    FROM public."VALE_SALIDA_DETALLE" d WHERE d.folio_n = v.folio_n), '[]') AS items
            FROM public."VALE_SALIDA" v WHERE v.folio_n = p_folio;
    END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE public.consultar_catalogos(INOUT resultado refcursor)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    OPEN resultado FOR SELECT
        (SELECT jsonb_agg(a ORDER BY a.nombre) FROM public."AREA" a) AS areas,
        (SELECT jsonb_agg(p ORDER BY p.nombre) FROM public."PROYECTO" p) AS proyectos,
        (SELECT jsonb_agg(e ORDER BY e.nombre) FROM (
            SELECT id_empleado, concat_ws(' ', primer_nombre, segundo_nombre,
                apellido_paterno, apellido_materno) AS nombre FROM public."EMPLEADO"
        ) e) AS empleados,
        (SELECT jsonb_agg(p ORDER BY p.descripcion_material) FROM public."PRODUCTO" p) AS productos;
END;
$$;

CREATE OR REPLACE PROCEDURE public.ejecutar_reporte(p_id integer, INOUT resultado refcursor)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    CASE p_id
        -- Materiales de cada vale
        WHEN 1 THEN OPEN resultado FOR
            SELECT vs.folio_n, vs.fecha_emision, pr.codigo_producto,
            pr.descripcion_material, pr.unidad, d.n_item,
            d.cantidad_solicitada, d.cantidad_autorizada, d.cantidad_entregada, d.observaciones
            FROM public.vales_vigentes AS vs
            JOIN public.detalles_vigentes AS d ON vs.folio_n = d.folio_n
            JOIN public."PRODUCTO" AS pr ON d.codigo_producto = pr.codigo_producto
            ORDER BY vs.folio_n, d.n_item;
        -- Vales emitidos durante 2026
        WHEN 2 THEN OPEN resultado FOR
            SELECT folio_n, fecha_emision, fecha_entrega, tipo_salida, motivo
            FROM public.vales_vigentes
            WHERE fecha_emision >= DATE '2026-01-01' AND fecha_emision < DATE '2027-01-01'
            ORDER BY fecha_emision, folio_n;
        -- Vales sin fecha de entrega registrada
        WHEN 3 THEN OPEN resultado FOR
            SELECT folio_n, fecha_emision, tipo_salida, motivo, id_area, id_proyecto
            FROM public.vales_vigentes
            WHERE fecha_entrega IS NULL
            ORDER BY fecha_emision, folio_n;
        -- Comparar cantidades solicitadas, autorizadas y entregadas
        WHEN 4 THEN OPEN resultado FOR
            SELECT d.folio_n, d.n_item, pr.descripcion_material, pr.unidad,
            d.cantidad_solicitada, d.cantidad_autorizada, d.cantidad_entregada,
            d.cantidad_solicitada - d.cantidad_autorizada AS cantidad_no_autorizada,
            d.cantidad_autorizada - d.cantidad_entregada AS cantidad_pendiente_de_entrega
            FROM public.detalles_vigentes AS d
            JOIN public."PRODUCTO" AS pr ON d.codigo_producto = pr.codigo_producto
            ORDER BY d.folio_n, d.n_item;
        -- Materiales autorizados por debajo de lo solicitado
        WHEN 5 THEN OPEN resultado FOR
            SELECT d.folio_n, d.n_item, pr.descripcion_material, pr.unidad,
            d.cantidad_solicitada, d.cantidad_autorizada,
            d.cantidad_solicitada - d.cantidad_autorizada AS cantidad_no_autorizada
            FROM public.detalles_vigentes AS d
            JOIN public."PRODUCTO" AS pr ON d.codigo_producto = pr.codigo_producto
            WHERE d.cantidad_autorizada < d.cantidad_solicitada
            ORDER BY d.folio_n, d.n_item;
        -- Diez productos con mayor cantidad solicitada
        WHEN 6 THEN OPEN resultado FOR
            SELECT pr.codigo_producto, pr.descripcion_material, pr.unidad,
            SUM(d.cantidad_solicitada) AS total_solicitado
            FROM public."PRODUCTO" AS pr
            JOIN public.detalles_vigentes AS d ON pr.codigo_producto = d.codigo_producto
            GROUP BY pr.codigo_producto, pr.descripcion_material, pr.unidad
            ORDER BY total_solicitado DESC, pr.codigo_producto
            LIMIT 10;
        -- Productos que no aparecen en ningun vale
        WHEN 7 THEN OPEN resultado FOR
            SELECT pr.codigo_producto, pr.descripcion_material, pr.unidad
            FROM public."PRODUCTO" AS pr
            LEFT JOIN public.detalles_vigentes AS d ON pr.codigo_producto = d.codigo_producto
            WHERE d.codigo_producto IS NULL
            ORDER BY pr.descripcion_material, pr.codigo_producto;
        -- Vales solicitados por empleado
        WHEN 8 THEN OPEN resultado FOR
            SELECT e.id_empleado,
            CONCAT_WS(' ', e.primer_nombre, e.segundo_nombre, e.apellido_paterno, e.apellido_materno) AS empleado,
            COUNT(vs.folio_n) AS total_vales_solicitados
            FROM public."EMPLEADO" AS e
            LEFT JOIN public.vales_vigentes AS vs ON e.id_empleado = vs.id_empleado_solicita
            GROUP BY e.id_empleado, e.primer_nombre, e.segundo_nombre, e.apellido_paterno, e.apellido_materno
            ORDER BY total_vales_solicitados DESC, e.id_empleado;
        -- Vales asignados al responsable de despacho
        WHEN 9 THEN OPEN resultado FOR
            SELECT e.id_empleado,
            CONCAT_WS(' ', e.primer_nombre, e.segundo_nombre, e.apellido_paterno, e.apellido_materno) AS empleado,
            COUNT(vs.folio_n) AS total_vales_asignados_despacho
            FROM public."EMPLEADO" AS e
            LEFT JOIN public.vales_vigentes AS vs ON e.id_empleado = vs.id_empleado_despacha
            GROUP BY e.id_empleado, e.primer_nombre, e.segundo_nombre, e.apellido_paterno, e.apellido_materno
            ORDER BY total_vales_asignados_despacho DESC, e.id_empleado;
        -- Vales y lineas de detalle por area
        WHEN 10 THEN OPEN resultado FOR
            SELECT a.id_area, a.nombre AS area,
            COUNT(DISTINCT vs.folio_n) AS total_vales,
            COUNT(d.n_item) AS total_lineas_detalle
            FROM public."AREA" AS a
            LEFT JOIN public.vales_vigentes AS vs ON a.id_area = vs.id_area
            LEFT JOIN public.detalles_vigentes AS d ON vs.folio_n = d.folio_n
            GROUP BY a.id_area, a.nombre
            ORDER BY total_vales DESC, a.id_area;
        -- Vales y productos distintos por proyecto
        WHEN 11 THEN OPEN resultado FOR
            SELECT p.id_proyecto, p.nombre AS proyecto,
            COUNT(DISTINCT vs.folio_n) AS total_vales,
            COUNT(DISTINCT d.codigo_producto) AS tipos_materiales
            FROM public."PROYECTO" AS p
            LEFT JOIN public.vales_vigentes AS vs ON p.id_proyecto = vs.id_proyecto
            LEFT JOIN public.detalles_vigentes AS d ON vs.folio_n = d.folio_n
            GROUP BY p.id_proyecto, p.nombre
            ORDER BY total_vales DESC, p.id_proyecto;
        -- Vales emitidos por mes
        WHEN 12 THEN OPEN resultado FOR
            SELECT DATE_TRUNC('month', fecha_emision)::date AS mes, COUNT(*) AS total_vales
            FROM public.vales_vigentes
            GROUP BY DATE_TRUNC('month', fecha_emision)
            ORDER BY mes;
        -- Vales con alguna firma sin registrar
        WHEN 13 THEN OPEN resultado FOR
            SELECT folio_n, fecha_emision, firma_solicita, firma_autoriza, firma_despacha
            FROM public.vales_vigentes
            WHERE NULLIF(BTRIM(firma_solicita), '') IS NULL
            OR NULLIF(BTRIM(firma_autoriza), '') IS NULL
            OR NULLIF(BTRIM(firma_despacha), '') IS NULL
            ORDER BY fecha_emision DESC, folio_n;
        -- Cantidades autorizadas pendientes de entrega
        WHEN 14 THEN OPEN resultado FOR
            SELECT vs.folio_n, vs.fecha_emision, vs.fecha_entrega, d.n_item,
            pr.codigo_producto, pr.descripcion_material, pr.unidad,
            d.cantidad_autorizada, d.cantidad_entregada,
            d.cantidad_autorizada - d.cantidad_entregada AS cantidad_pendiente
            FROM public.vales_vigentes AS vs
            JOIN public.detalles_vigentes AS d ON vs.folio_n = d.folio_n
            JOIN public."PRODUCTO" AS pr ON d.codigo_producto = pr.codigo_producto
            WHERE d.cantidad_entregada >= 0 AND d.cantidad_entregada < d.cantidad_autorizada
            ORDER BY vs.fecha_emision, vs.folio_n, d.n_item;
        ELSE RAISE EXCEPTION 'Reporte desconocido.' USING ERRCODE = '22023';
    END CASE;
END;
$$;

REVOKE ALL ON PROCEDURE public.consultar_vales(text, refcursor),
    public.consultar_catalogos(refcursor), public.ejecutar_reporte(integer, refcursor) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE public.consultar_vales(text, refcursor),
    public.consultar_catalogos(refcursor), public.ejecutar_reporte(integer, refcursor) TO app_almacen;
