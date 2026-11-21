-- Esquema base de ValesTrack para una base vacía.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_almacen') THEN
        CREATE ROLE app_almacen NOLOGIN;
    END IF;
END;
$$;


CREATE TABLE public."AREA" (
    id_area integer NOT NULL,
    nombre character varying(100) NOT NULL,
    CONSTRAINT ck_area_id_positivo CHECK ((id_area > 0)),
    CONSTRAINT ck_area_nombre_no_vacio CHECK ((btrim((nombre)::text) <> ''::text))
);

CREATE TABLE public."EMPLEADO" (
    id_empleado integer NOT NULL,
    primer_nombre character varying(50) NOT NULL,
    segundo_nombre character varying(50),
    apellido_paterno character varying(60) NOT NULL,
    apellido_materno character varying(60) NOT NULL,
    CONSTRAINT ck_empleado_apellido_materno_no_vacio CHECK ((btrim((apellido_materno)::text) <> ''::text)),
    CONSTRAINT ck_empleado_apellido_paterno_no_vacio CHECK ((btrim((apellido_paterno)::text) <> ''::text)),
    CONSTRAINT ck_empleado_id_positivo CHECK ((id_empleado > 0)),
    CONSTRAINT ck_empleado_primer_nombre_no_vacio CHECK ((btrim((primer_nombre)::text) <> ''::text))
);

CREATE TABLE public."PRODUCTO" (
    codigo_producto character varying(20) NOT NULL,
    descripcion_material character varying(250) NOT NULL,
    unidad character varying(20) NOT NULL,
    CONSTRAINT ck_producto_codigo_no_vacio CHECK ((btrim((codigo_producto)::text) <> ''::text)),
    CONSTRAINT ck_producto_descripcion_no_vacia CHECK ((btrim((descripcion_material)::text) <> ''::text)),
    CONSTRAINT ck_producto_unidad_no_vacia CHECK ((btrim((unidad)::text) <> ''::text))
);

CREATE TABLE public."PROYECTO" (
    id_proyecto integer NOT NULL,
    nombre character varying(150) NOT NULL,
    CONSTRAINT ck_proyecto_id_positivo CHECK ((id_proyecto > 0)),
    CONSTRAINT ck_proyecto_nombre_no_vacio CHECK ((btrim((nombre)::text) <> ''::text))
);

CREATE TABLE public."VALE_SALIDA" (
    folio_n character varying(20) NOT NULL,
    fecha_emision date NOT NULL,
    fecha_entrega date,
    tipo_salida character varying(50) NOT NULL,
    motivo character varying(250) NOT NULL,
    id_area integer NOT NULL,
    id_proyecto integer NOT NULL,
    id_empleado_despacha integer NOT NULL,
    id_empleado_solicita integer NOT NULL,
    id_empleado_autoriza integer NOT NULL,
    firma_autoriza character varying,
    firma_despacha character varying,
    firma_solicita character varying,
    CONSTRAINT ck_vale_folio_no_vacio CHECK ((btrim((folio_n)::text) <> ''::text)),
    CONSTRAINT ck_vale_motivo_no_vacio CHECK ((btrim((motivo)::text) <> ''::text)),
    CONSTRAINT ck_vale_tipo_no_vacio CHECK ((btrim((tipo_salida)::text) <> ''::text))
);

CREATE TABLE public."VALE_SALIDA_DETALLE" (
    folio_n character varying(20) NOT NULL,
    n_item integer NOT NULL,
    codigo_producto character varying(20) NOT NULL,
    cantidad_solicitada numeric(12,3) NOT NULL,
    cantidad_entregada numeric(12,3) NOT NULL,
    cantidad_autorizada numeric(12,3) NOT NULL,
    observaciones character varying(500),
    CONSTRAINT ck_detalle_autorizada_no_negativa CHECK ((cantidad_autorizada >= (0)::numeric)),
    CONSTRAINT ck_detalle_entregada_no_negativa CHECK ((cantidad_entregada >= (0)::numeric)),
    CONSTRAINT ck_detalle_item_rango CHECK (((n_item >= 1) AND (n_item <= 9999))),
    CONSTRAINT ck_detalle_solicitada_positiva CHECK ((cantidad_solicitada > (0)::numeric))
);

ALTER TABLE ONLY public."AREA"
    ADD CONSTRAINT "AREA_pkey" PRIMARY KEY (id_area);

ALTER TABLE ONLY public."EMPLEADO"
    ADD CONSTRAINT "EMPLEADO_pkey" PRIMARY KEY (id_empleado);

ALTER TABLE ONLY public."PRODUCTO"
    ADD CONSTRAINT "PRODUCTO_pkey" PRIMARY KEY (codigo_producto);

ALTER TABLE ONLY public."PROYECTO"
    ADD CONSTRAINT "PROYECTO_pkey" PRIMARY KEY (id_proyecto);

ALTER TABLE ONLY public."VALE_SALIDA_DETALLE"
    ADD CONSTRAINT "VALE_SALIDA_DETALLE_pkey" PRIMARY KEY (folio_n, n_item);

ALTER TABLE ONLY public."VALE_SALIDA"
    ADD CONSTRAINT "VALE_SALIDA_pkey" PRIMARY KEY (folio_n);

ALTER TABLE ONLY public."VALE_SALIDA_DETALLE"
    ADD CONSTRAINT "VALE_SALIDA_DETALLE_codigo_producto_fkey" FOREIGN KEY (codigo_producto) REFERENCES public."PRODUCTO"(codigo_producto) DEFERRABLE;

ALTER TABLE ONLY public."VALE_SALIDA_DETALLE"
    ADD CONSTRAINT "VALE_SALIDA_DETALLE_folio_n_fkey" FOREIGN KEY (folio_n) REFERENCES public."VALE_SALIDA"(folio_n) DEFERRABLE;

ALTER TABLE ONLY public."VALE_SALIDA"
    ADD CONSTRAINT "VALE_SALIDA_id_area_fkey" FOREIGN KEY (id_area) REFERENCES public."AREA"(id_area) DEFERRABLE;

ALTER TABLE ONLY public."VALE_SALIDA"
    ADD CONSTRAINT "VALE_SALIDA_id_empleado_autoriza_fkey" FOREIGN KEY (id_empleado_autoriza) REFERENCES public."EMPLEADO"(id_empleado) DEFERRABLE;

ALTER TABLE ONLY public."VALE_SALIDA"
    ADD CONSTRAINT "VALE_SALIDA_id_empleado_despacha_fkey" FOREIGN KEY (id_empleado_despacha) REFERENCES public."EMPLEADO"(id_empleado) DEFERRABLE;

ALTER TABLE ONLY public."VALE_SALIDA"
    ADD CONSTRAINT "VALE_SALIDA_id_empleado_solicita_fkey" FOREIGN KEY (id_empleado_solicita) REFERENCES public."EMPLEADO"(id_empleado) DEFERRABLE;

ALTER TABLE ONLY public."VALE_SALIDA"
    ADD CONSTRAINT "VALE_SALIDA_id_proyecto_fkey" FOREIGN KEY (id_proyecto) REFERENCES public."PROYECTO"(id_proyecto) DEFERRABLE;

GRANT USAGE ON SCHEMA public TO app_almacen;

GRANT SELECT ON TABLE public."AREA" TO app_almacen;

GRANT SELECT ON TABLE public."EMPLEADO" TO app_almacen;

GRANT SELECT ON TABLE public."PRODUCTO" TO app_almacen;

GRANT SELECT ON TABLE public."PROYECTO" TO app_almacen;

GRANT SELECT ON TABLE public."VALE_SALIDA" TO app_almacen;

GRANT SELECT ON TABLE public."VALE_SALIDA_DETALLE" TO app_almacen;
