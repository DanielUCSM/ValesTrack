# ValesTrack

Aplicación para registrar, consultar y controlar vales de salida de materiales. Usa Node.js y PostgreSQL en Neon.

## Código fuente

La carpeta [codigo-fuente](codigo-fuente/) reúne el servidor, la interfaz y los scripts SQL. La [guía técnica](codigo-fuente/NEON.md) describe la configuración de PostgreSQL. Las [instrucciones de instalación](codigo-fuente/INSTALACION.md) explican el inicio de la aplicación. El archivo `.env.example` contiene las variables de configuración.

Los scripts del esquema y la funcionalidad están en [sql](codigo-fuente/sql/). El script de datos adicionales usa catálogos y vales de prueba cargados previamente. El respaldo con registros se entrega por separado.
