-- Migración acumulativa. Ejecutar con psql -1 como propietario del esquema.
ALTER TABLE public."AREA" ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public."PROYECTO" ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public."PRODUCTO" ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public."EMPLEADO" ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public."VALE_SALIDA_DETALLE" ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS vt_producto_codigo ON public."PRODUCTO" (lower(btrim(codigo_producto)));
CREATE UNIQUE INDEX IF NOT EXISTS vt_vale_folio ON public."VALE_SALIDA" (lower(btrim(folio_n)));

CREATE TABLE IF NOT EXISTS public."AUDITORIA_LOG" (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tabla text NOT NULL,
    accion text NOT NULL,
    registro text NOT NULL,
    detalle jsonb NOT NULL,
    fecha_hora timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.vt_auditar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    anterior jsonb;
    actual jsonb;
    fila jsonb;
    accion text := TG_OP;
    antes_activo boolean;
    ahora_activo boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN anterior := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN actual := to_jsonb(NEW); END IF;
    fila := coalesce(actual, anterior);

    IF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'VALE_SALIDA' THEN
            antes_activo := anterior->>'anulado_en' IS NULL;
            ahora_activo := actual->>'anulado_en' IS NULL;
        ELSE
            antes_activo := (anterior->>'activo')::boolean;
            ahora_activo := (actual->>'activo')::boolean;
        END IF;
        IF antes_activo AND NOT ahora_activo THEN accion := 'BORRADO LÓGICO'; END IF;
        IF NOT antes_activo AND ahora_activo THEN accion := 'RECUPERACIÓN'; END IF;
    END IF;

    INSERT INTO public."AUDITORIA_LOG" (tabla, accion, registro, detalle)
    VALUES (TG_TABLE_NAME, accion,
        fila->>TG_ARGV[0] || CASE WHEN TG_NARGS = 2 THEN ' / ' || (fila->>TG_ARGV[1]) ELSE '' END,
        jsonb_build_object('antes', anterior, 'despues', actual));
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.vt_validar_catalogo()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    fila jsonb := to_jsonb(NEW);
    campo text;
BEGIN
    FOREACH campo IN ARRAY TG_ARGV LOOP
        IF nullif(regexp_replace(fila->>campo, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') IS NULL THEN
            RAISE EXCEPTION 'El campo % es obligatorio.', replace(campo, '_', ' ') USING ERRCODE = 'PVT01';
        END IF;
        IF campo LIKE 'id_%' AND (fila->>campo)::integer <= 0 THEN
            RAISE EXCEPTION 'El identificador debe ser un entero positivo.' USING ERRCODE = 'PVT01';
        END IF;
    END LOOP;
    IF TG_TABLE_NAME = 'PRODUCTO' AND (fila->>'codigo_producto') ~ '[/[:cntrl:]]' THEN
        RAISE EXCEPTION 'El código no puede contener barras ni caracteres de control.' USING ERRCODE = 'PVT01';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_vale()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    hoy date := (statement_timestamp() AT TIME ZONE 'America/Lima')::date;
BEGIN
    IF NEW.folio_n IS NULL OR NEW.folio_n !~ '[^[:space:]]' OR NEW.folio_n ~ '[/[:cntrl:]]' THEN
        RAISE EXCEPTION 'Introduce un folio válido sin barras.' USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.tipo_salida IS NULL OR NEW.tipo_salida !~ '[^[:space:]]'
        OR NEW.motivo IS NULL OR NEW.motivo !~ '[^[:space:]]' THEN
        RAISE EXCEPTION 'El tipo de salida y el motivo son obligatorios.' USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.fecha_emision IS NULL THEN
        RAISE EXCEPTION 'La fecha de emisión es obligatoria.' USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.fecha_emision > hoy THEN
        RAISE EXCEPTION 'La fecha de emisión no puede ser futura.' USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.fecha_entrega > hoy THEN
        RAISE EXCEPTION 'La fecha de entrega no puede ser futura.' USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.fecha_entrega < NEW.fecha_emision THEN
        RAISE EXCEPTION 'La fecha de entrega no puede ser anterior a la emisión.' USING ERRCODE = 'PVT01';
    END IF;
    IF coalesce(NEW.id_area, 0) <= 0 OR coalesce(NEW.id_proyecto, 0) <= 0
       OR coalesce(NEW.id_empleado_solicita, 0) <= 0 OR coalesce(NEW.id_empleado_autoriza, 0) <= 0
       OR coalesce(NEW.id_empleado_despacha, 0) <= 0 THEN
        RAISE EXCEPTION 'Selecciona un área, un proyecto y los tres responsables.' USING ERRCODE = 'PVT01';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_detalle_vale()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.codigo_producto IS NULL OR NEW.codigo_producto !~ '[^[:space:]]' THEN
        RAISE EXCEPTION 'Selecciona un material para el ítem %.', NEW.n_item USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.n_item IS NULL OR NEW.n_item NOT BETWEEN 1 AND 9999 THEN
        RAISE EXCEPTION 'El número de ítem debe estar entre 1 y 9999.' USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.cantidad_solicitada IS NULL OR NEW.cantidad_autorizada IS NULL OR NEW.cantidad_entregada IS NULL
       OR 'NaN'::numeric IN (NEW.cantidad_solicitada, NEW.cantidad_autorizada, NEW.cantidad_entregada) THEN
        RAISE EXCEPTION 'Ítem %: las tres cantidades deben ser números válidos.', NEW.n_item USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.cantidad_solicitada <= 0 OR NEW.cantidad_autorizada < 0 OR NEW.cantidad_entregada < 0 THEN
        RAISE EXCEPTION 'Ítem %: la solicitada debe ser mayor que cero y las demás no pueden ser negativas.', NEW.n_item USING ERRCODE = 'PVT01';
    END IF;
    IF NEW.cantidad_autorizada > NEW.cantidad_solicitada OR NEW.cantidad_entregada > NEW.cantidad_autorizada THEN
        RAISE EXCEPTION 'Ítem %: se requiere entregada ≤ autorizada ≤ solicitada.', NEW.n_item USING ERRCODE = 'PVT01';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_vale ON public."VALE_SALIDA";
CREATE TRIGGER validar_vale BEFORE INSERT OR UPDATE ON public."VALE_SALIDA"
FOR EACH ROW EXECUTE FUNCTION public.validar_vale();

DO $$
DECLARE
    fila record;
    argumentos text;
BEGIN
    FOR fila IN SELECT * FROM (VALUES
        ('AREA', 'id_area', 'id_area,nombre'),
        ('PROYECTO', 'id_proyecto', 'id_proyecto,nombre'),
        ('EMPLEADO', 'id_empleado', 'id_empleado,primer_nombre,apellido_paterno,apellido_materno'),
        ('PRODUCTO', 'codigo_producto', 'codigo_producto,descripcion_material,unidad'),
        ('VALE_SALIDA', 'folio_n', NULL),
        ('VALE_SALIDA_DETALLE', 'folio_n,n_item', NULL)
    ) AS t(tabla, clave, requeridos) LOOP
        SELECT string_agg(quote_literal(x), ',') INTO argumentos FROM unnest(string_to_array(fila.clave, ',')) x;
        EXECUTE format('DROP TRIGGER IF EXISTS vt_auditar ON public.%I', fila.tabla);
        EXECUTE format('CREATE TRIGGER vt_auditar AFTER INSERT OR UPDATE OR DELETE ON public.%I
            FOR EACH ROW EXECUTE FUNCTION public.vt_auditar(%s)', fila.tabla, argumentos);
        IF fila.requeridos IS NOT NULL THEN
            SELECT string_agg(quote_literal(x), ',') INTO argumentos FROM unnest(string_to_array(fila.requeridos, ',')) x;
            EXECUTE format('DROP TRIGGER IF EXISTS vt_validar ON public.%I', fila.tabla);
            EXECUTE format('CREATE TRIGGER vt_validar BEFORE INSERT OR UPDATE ON public.%I
                FOR EACH ROW EXECUTE FUNCTION public.vt_validar_catalogo(%s)', fila.tabla, argumentos);
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE PROCEDURE public.vt_catalogo(p_tabla text, p_accion text, p_clave text, p_datos jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    clave text;
    campos text[];
    columnas text;
    asignaciones text;
    modificados integer;
BEGIN
    CASE p_tabla
        WHEN 'AREA' THEN clave := 'id_area'; campos := ARRAY['nombre'];
        WHEN 'PROYECTO' THEN clave := 'id_proyecto'; campos := ARRAY['nombre'];
        WHEN 'EMPLEADO' THEN clave := 'id_empleado'; campos := ARRAY['primer_nombre','segundo_nombre','apellido_paterno','apellido_materno'];
        WHEN 'PRODUCTO' THEN clave := 'codigo_producto'; campos := ARRAY['descripcion_material','unidad'];
        ELSE RAISE EXCEPTION 'Catálogo desconocido.' USING ERRCODE = 'PVT01';
    END CASE;
    IF p_accion = 'crear' THEN
        SELECT string_agg(format('%I', c), ',') INTO columnas FROM unnest(array_prepend(clave, campos)) c;
        EXECUTE format('INSERT INTO public.%1$I (%2$s)
            SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1)', p_tabla, columnas) USING p_datos;
    ELSIF p_accion = 'editar' THEN
        SELECT string_agg(format('%1$I = d.%1$I', c), ',') INTO asignaciones FROM unnest(campos) c;
        EXECUTE format('UPDATE public.%1$I t SET %2$s
            FROM jsonb_populate_record(NULL::public.%1$I, $1) d
            WHERE t.%3$I::text = $2 AND t.activo', p_tabla, asignaciones, clave) USING p_datos, p_clave;
    ELSIF p_accion IN ('inactivar', 'recuperar') THEN
        EXECUTE format('UPDATE public.%I SET activo = $1 WHERE %I::text = $2 AND activo IS DISTINCT FROM $1',
            p_tabla, clave) USING p_accion = 'recuperar', p_clave;
    ELSE
        RAISE EXCEPTION 'Operación desconocida.' USING ERRCODE = 'PVT01';
    END IF;
    GET DIAGNOSTICS modificados = ROW_COUNT;
    IF modificados = 0 THEN
        RAISE EXCEPTION 'El registro cambió de estado o no existe.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- Las líneas conservan su clave. Las omitidas se inactivan y las recuperadas
-- vuelven a aparecer con el mismo n_item, sin reemplazar su historial.
CREATE OR REPLACE PROCEDURE public.guardar_vale(p_datos jsonb, p_editar boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    datos public."VALE_SALIDA"%ROWTYPE;
    linea public."VALE_SALIDA_DETALLE"%ROWTYPE;
    entrada jsonb;
    siguiente integer;
    conservados integer[] := ARRAY[]::integer[];
BEGIN
    datos := jsonb_populate_record(NULL::public."VALE_SALIDA", p_datos);
    IF jsonb_typeof(p_datos->'items') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Envía una lista de materiales.' USING ERRCODE = 'PVT01';
    END IF;
    IF jsonb_array_length(p_datos->'items') NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'El vale debe tener entre 1 y 1000 ítems activos.' USING ERRCODE = 'PVT01';
    END IF;

    IF p_editar THEN
        UPDATE public."VALE_SALIDA" SET
            fecha_emision = datos.fecha_emision, fecha_entrega = datos.fecha_entrega,
            tipo_salida = datos.tipo_salida, motivo = datos.motivo,
            id_area = datos.id_area, id_proyecto = datos.id_proyecto,
            id_empleado_despacha = datos.id_empleado_despacha,
            id_empleado_solicita = datos.id_empleado_solicita,
            id_empleado_autoriza = datos.id_empleado_autoriza,
            firma_autoriza = datos.firma_autoriza, firma_despacha = datos.firma_despacha,
            firma_solicita = datos.firma_solicita
        WHERE folio_n = datos.folio_n AND anulado_en IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'El vale no existe o está en la papelera.' USING ERRCODE = 'P0002';
        END IF;
    ELSE
        datos.anulado_en := NULL;
        INSERT INTO public."VALE_SALIDA" SELECT (datos).*;
    END IF;

    SELECT coalesce(max(n_item), 0) + 1 INTO siguiente
    FROM public."VALE_SALIDA_DETALLE" WHERE folio_n = datos.folio_n;
    FOR entrada IN SELECT value FROM jsonb_array_elements(p_datos->'items') LOOP
        linea := jsonb_populate_record(NULL::public."VALE_SALIDA_DETALLE", entrada);
        IF linea.n_item IS NULL THEN
            linea.folio_n := datos.folio_n;
            linea.n_item := siguiente;
            linea.activo := true;
            INSERT INTO public."VALE_SALIDA_DETALLE" SELECT (linea).*;
            siguiente := siguiente + 1;
        ELSE
            IF NOT p_editar OR linea.n_item = ANY(conservados) THEN
                RAISE EXCEPTION 'El número de ítem está repetido o no corresponde al vale.' USING ERRCODE = 'PVT01';
            END IF;
            UPDATE public."VALE_SALIDA_DETALLE" SET
                codigo_producto = linea.codigo_producto,
                cantidad_solicitada = linea.cantidad_solicitada,
                cantidad_autorizada = linea.cantidad_autorizada,
                cantidad_entregada = linea.cantidad_entregada,
                observaciones = linea.observaciones, activo = true
            WHERE folio_n = datos.folio_n AND n_item = linea.n_item;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'El ítem % no pertenece al vale.', linea.n_item USING ERRCODE = 'PVT01';
            END IF;
        END IF;
        conservados := array_append(conservados, linea.n_item);
    END LOOP;

    UPDATE public."VALE_SALIDA_DETALLE" SET activo = false
    WHERE folio_n = datos.folio_n AND activo AND NOT (n_item = ANY(conservados));
END;
$$;

CREATE OR REPLACE PROCEDURE public.recuperar_vale(p_folio text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public."VALE_SALIDA" SET anulado_en = NULL
    WHERE folio_n = p_folio AND anulado_en IS NOT NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El vale no está en la papelera.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE VIEW public.detalles_vigentes AS
    SELECT d.* FROM public."VALE_SALIDA_DETALLE" d
    JOIN public.vales_vigentes v USING (folio_n) WHERE d.activo;

REVOKE ALL ON PROCEDURE public.vt_catalogo(text,text,text,jsonb), public.recuperar_vale(text) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE public.vt_catalogo(text,text,text,jsonb), public.recuperar_vale(text) TO app_almacen;
GRANT SELECT ON public."AUDITORIA_LOG" TO app_almacen;

CREATE OR REPLACE PROCEDURE public.consultar_vales(p_folio text, INOUT resultado refcursor)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_folio IS NULL THEN
        OPEN resultado FOR
            SELECT v.folio_n, v.fecha_emision::text, v.fecha_entrega::text, v.tipo_salida, v.id_area, v.id_proyecto,
                   a.nombre AS area, p.nombre AS proyecto,
                   concat_ws(' ', e.primer_nombre, e.apellido_paterno) AS solicitante,
                   count(d.n_item) FILTER (WHERE d.activo)::int AS total_items,
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
