# ValesTrack con PostgreSQL compartido

Cada ejecutable inicia una copia de ValesTrack en su computadora y abre su propia interfaz. Ambos clientes se conectan al mismo PostgreSQL mediante TLS. La aplicación y Node.js vienen en los paquetes. Los equipos pueden usar cualquier servidor PostgreSQL 18 accesible desde ambos. La computadora que hospeda PostgreSQL debe permanecer disponible.

## 1. Preparar PostgreSQL una sola vez

Para conservar los vales actuales, respalda la base de Arch y restáurala en el PostgreSQL nuevo. Antes de restaurar, crea el rol de aplicación `app_almacen` en el servidor de destino y asigna una contraseña diferente de las contraseñas del aplicativo. Respeta los propietarios y permisos del respaldo o configúralos con el administrador del servidor. Después aplica `sql/05_cuentas_compartidas.sql` como propietario del esquema:

```bash
psql -h HOST_POSTGRESQL -U USUARIO_PROPIETARIO -d NOMBRE_BASE -v ON_ERROR_STOP=1 --single-transaction -f sql/05_cuentas_compartidas.sql
```

Para iniciar una base de prueba vacía, aplica primero los scripts 00, 01, 02, 03 y 04 en ese orden y luego el 05. Usa una cuenta con los permisos que requieren los scripts de restauración, incluida la gestión de propietarios de objetos.

## 2. Configurar los clientes

En Linux copia `.env.example` a `.env`. En Windows abre el EXE. El primer arranque crea `%LOCALAPPDATA%\ValesTrack-Compartido\conexion.env` y lo abre en el editor. En ambas computadoras configura los datos de la misma base:

```dotenv
DB_HOST=servidor-postgresql
DB_PORT=5432
DB_NAME=valestrack
DB_USER=app_almacen
DB_PASSWORD=
DB_SSL=1
PORT=0
```

Escribe la contraseña de PostgreSQL en `DB_PASSWORD`. Si el servidor usa una CA privada, indica una ruta absoluta en `DB_SSL_CA`. Usa en `DB_HOST` el nombre incluido en el certificado TLS. `PORT=0` elige automáticamente un puerto para la interfaz local. Cada computadora recibe su propia URL de loopback. Una URL local distinta no cambia qué base utiliza.

## 3. Preparar las cuentas una sola vez

Desde la carpeta extraída en Linux, importa las cuentas de tu instalación anterior (sus contraseñas se conservan):

```bash
./runtime/node --env-file=.env preparar-cuentas.js /ruta/a/tu/ValesTrack/.cuentas.json
```

Si es una instalación nueva y prefieres generar un administrador inicial, ejecuta el mismo comando sin la ruta al archivo. Guarda la contraseña que imprime y crea las demás cuentas desde Usuarios. El comando conserva cualquier cuenta que ya exista en la base.

## 4. Arrancar

En Linux ejecuta `./ValesTrack` o `./Iniciar-ValesTrack.sh`. En Windows vuelve a abrir el EXE. Ingresa con una cuenta de ValesTrack en cualquier equipo y recarga el listado después de una modificación ajena.

El rol SQL se configura en los equipos que ejecutan el aplicativo. Este modo requiere equipos de confianza: alguien que tenga esas credenciales puede usar las capacidades del rol directamente en PostgreSQL. Para usuarios externos o equipos no administrados, un servidor de aplicación central separado de los equipos personales permite reservar las credenciales SQL al servidor.
