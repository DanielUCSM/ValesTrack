ALTER TABLE public."VALE_SALIDA"
    ADD COLUMN IF NOT EXISTS motivo_anulacion text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = 'public."VALE_SALIDA"'::regclass
        AND conname = 'vt_motivo_anulacion_estado'
    ) THEN
        ALTER TABLE public."VALE_SALIDA"
            ADD CONSTRAINT vt_motivo_anulacion_estado CHECK (
                motivo_anulacion IS NULL OR (anulado_en IS NOT NULL AND length(motivo_anulacion) <= 500)
            );
    END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE public.vt_entregar(p_folio text, p_fecha date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_fecha IS NULL THEN
        RAISE EXCEPTION 'Indica la fecha de entrega.' USING ERRCODE = 'PVT01';
    END IF;
    UPDATE public."VALE_SALIDA" SET fecha_entrega = p_fecha
    WHERE folio_n = p_folio AND anulado_en IS NULL AND fecha_entrega IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solo se puede marcar como entregado un vale pendiente.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE public.vt_anular(p_folio text, p_motivo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_motivo IS NULL OR p_motivo !~ '[^[:space:]]' OR length(p_motivo) > 500 THEN
        RAISE EXCEPTION 'Escribe un motivo de anulación de hasta 500 caracteres.' USING ERRCODE = 'PVT01';
    END IF;
    UPDATE public."VALE_SALIDA" SET anulado_en = clock_timestamp(), motivo_anulacion = btrim(p_motivo)
    WHERE folio_n = p_folio AND anulado_en IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El vale no existe o ya está en la papelera.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE public.recuperar_vale(p_folio text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public."VALE_SALIDA" SET anulado_en = NULL, motivo_anulacion = NULL
    WHERE folio_n = p_folio AND anulado_en IS NOT NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El vale no está en la papelera.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

REVOKE ALL ON PROCEDURE public.vt_entregar(text,date), public.vt_anular(text,text), public.anular_vale(text) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE public.anular_vale(text) FROM app_almacen;
GRANT EXECUTE ON PROCEDURE public.vt_entregar(text,date), public.vt_anular(text,text) TO app_almacen;
