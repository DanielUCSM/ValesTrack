-- Doce vales ficticios, de cuatro clases, y tres materiales por vale.
DO $$
DECLARE
    n integer;
    cabecera jsonb;
    items jsonb;
    folio text;
BEGIN
    FOR n IN 1..12 LOOP
        folio := 'E5-PRUEBA-' || lpad(n::text, 2, '0');
        IF EXISTS (SELECT 1 FROM public."VALE_SALIDA" WHERE folio_n = folio) THEN
            CONTINUE;
        END IF;
        SELECT jsonb_agg(jsonb_build_object(
            'codigo_producto', codigo_producto, 'cantidad_solicitada', 12,
            'cantidad_autorizada', 10,
            'cantidad_entregada', CASE n % 4 WHEN 1 THEN 10 WHEN 2 THEN 6 ELSE 0 END,
            'observaciones', 'Datos ficticios de la Entrega 5'
        ) ORDER BY codigo_producto) INTO items
        FROM (SELECT codigo_producto FROM public."PRODUCTO" ORDER BY codigo_producto
              OFFSET (n - 1) % 10 LIMIT 3) productos;

        SELECT jsonb_build_object('folio_n', folio, 'fecha_emision', DATE '2026-10-01' + n,
            'fecha_entrega', CASE WHEN n % 4 IN (1, 2) THEN DATE '2026-10-02' + n END,
            'tipo_salida', tipo_salida, 'motivo', 'Caso ficticio de la Entrega 5',
            'id_area', id_area, 'id_proyecto', id_proyecto,
            'id_empleado_solicita', id_empleado_solicita, 'id_empleado_autoriza', id_empleado_autoriza,
            'id_empleado_despacha', id_empleado_despacha, 'items', items)
        INTO cabecera FROM public."VALE_SALIDA"
        WHERE folio_n NOT LIKE 'E5-PRUEBA-%' ORDER BY folio_n OFFSET n - 1 LIMIT 1;
        CALL public.guardar_vale(cabecera, false);
        IF n % 4 = 0 THEN CALL public.anular_vale(folio); END IF;
    END LOOP;
END;
$$;
