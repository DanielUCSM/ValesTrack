# ValesTrack con Neon Postgres

ValesTrack requiere Node.js 22.15 o posterior. La interfaz sigue abriéndose en el navegador del equipo que ejecuta `npm start`. Cada instancia consulta la misma base de datos cuando usa la misma conexión de Neon. Neon aloja PostgreSQL. El proceso Node.js sigue ejecutándose donde inicies ValesTrack.

## Vincular el proyecto

```sh
npm ci
npm i -g neon@latest
neon login
neon init -y --org-id org-orange-resonance-74738885 --project-id bitter-night-87218963 --branch production --services postgres
neon config plan
neon deploy
npm run build
```

Si falla la instalación del complemento para el agente, vuelve a ejecutar el comando de `neon init` con `--no-agent-setup`. Puedes instalar la documentación para el agente por separado con `neon skills -y -a codex -s neon -s neon-postgres`.

Neon escribe `DATABASE_URL` y `DATABASE_URL_UNPOOLED` en `.env.local` o `.env`. ValesTrack usa la primera para ejecutar la aplicación. Conserva la URL directa para administrar el esquema y restaurar respaldos. Las variables del proceso tienen prioridad, seguidas de `.env.local` y `.env`. Mantén ambos archivos fuera del código distribuido.

## Preparar la base

Si vas a conservar vales, catálogos y cuentas existentes, genera el respaldo con `pg_dump --no-owner` y restáuralo mediante una conexión directa del propietario. Si el respaldo incluye permisos para el rol `app_almacen`, crea ese rol en el destino antes de restaurar. Si el respaldo contiene el esquema hasta el paso 04, aplica `sql/05_cuentas_compartidas.sql` para habilitar las cuentas compartidas. Para una instalación que ya contiene el esquema y un administrador, continúa con el arranque.

Para una base nueva y vacía, ejecuta lo siguiente con `psql` 18. Exporta `DATABASE_URL_UNPOOLED` en tu terminal antes de ejecutarlo. Usa la URL directa de un rol propietario con permiso para crear roles.

```sh
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 --single-transaction \
  -f sql/00_esquema_vacio.sql -f sql/01_aplicativo.sql \
  -f sql/03_valestrack.sql -f sql/04_estados.sql -f sql/05_cuentas_compartidas.sql
```

Para la conexión de la aplicación, usa la URL agrupada de un rol de inicio de sesión dedicado con membresía en `app_almacen` y asígnala a `DATABASE_URL`. El script de esquema crea `app_almacen` como rol de permisos si aún no existe. Guarda las credenciales solo en los equipos que ejecuten el servidor Node.js de ValesTrack.

Si faltan las cuentas del aplicativo, usa `npm run cuentas -- /ruta/.cuentas.json` para importarlas con sus contraseñas actuales. Para una instalación nueva usa `npm run cuentas` y guarda la contraseña inicial que muestra la terminal.

## Arrancar

```sh
npm start
```

Abre la dirección que imprima ValesTrack, inicia sesión y comprueba la bandeja de vales y los reportes.
