# Instalación de ValesTrack

Para usar el código fuente con PostgreSQL en Neon, consulta [NEON.md](NEON.md).

Consulta [CONFIGURACION-COMPARTIDA.md](CONFIGURACION-COMPARTIDA.md) para preparar PostgreSQL, importar las cuentas previas y configurar las dos versiones nativas.

En esta edición, las cuentas se guardan en PostgreSQL. El archivo `.cuentas.json` de la edición anterior sirve para importar cuentas una sola vez mediante `preparar-cuentas.js`.

El perfil operador registra, modifica y anula vales. El perfil cliente consulta vales vigentes sin acceder a las firmas. El perfil administrador gestiona usuarios, catálogos, auditoría y recuperación de vales. Desde **Generar vale** se puede descargar o imprimir el PDF A4.
