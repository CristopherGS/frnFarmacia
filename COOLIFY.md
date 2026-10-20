# Frontend en Coolify

El registro recibido muestra compilación Angular terminada, pero construcción mediante **Railpack** con Node 22 y arranque `npm run start`. Ese comando inicia Angular en desarrollo, con proxy hacia localhost:8080; no corresponde al despliegue separado de frontend/backend.

## Configuración de esta aplicación

| Campo | Valor |
|---|---|
| Repositorio | `CristopherGS/frnFarmacia` |
| Rama | `deploy` |
| Build strategy / Build pack | **Dockerfile** |
| Base directory | `/` |
| Dockerfile location | `/Dockerfile` |
| Puerto interno / Ports Exposes | `80` |
| Dominio | `https://med.sglabs.lat` |
| Comando de inicio personalizado | Vacío (usar el de la imagen Nginx) |
| Healthcheck | HTTP, puerto 80, ruta `/healthz`, estado 200 |
| Variable de ejecución | `API_UPSTREAM=http://<nombre-interno-real-del-backend>:8080` |

El nombre entre `<...>` es un marcador: reemplazarlo por el nombre o alias real del backend en la red privada de Coolify. Ambas aplicaciones deben compartir esa red. No usar `localhost`, que dentro del frontend apunta al propio frontend. No usar el nombre de ejemplo `api` salvo que se haya configurado ese alias realmente.

También se admite un upstream HTTPS, por ejemplo `https://bknmed.sglabs.lat`, pero si Cloudflare protege esa ruta con un desafío interactivo el proxy no podrá autenticar usuarios. Se recomienda conexión privada entre frontend y backend; el navegador llama `/api/v1` en el mismo dominio del frontend.

Guardar y volver a desplegar. En el nuevo registro deben aparecer las etapas del Dockerfile (Node 24 y después Nginx), no el plan Railpack ni `ng serve`. Los archivos estáticos están en `/app/dist/farmacia-web/browser` y el Dockerfile ya los copia a Nginx.

## Comprobación

1. `https://med.sglabs.lat/healthz` debe responder `ok`.
2. La raíz debe mostrar el acceso de SG Farma.
3. `/api/v1/auth/csrf` debe devolver JSON con un token, no HTML de Cloudflare, `502`, ni el HTML del frontend.
4. Iniciar sesión con el administrador del backend remoto; las credenciales locales no se trasladan a producción.

El frontend ahora puede arrancar aunque el nombre de la API todavía no resuelva; en ese caso solo las llamadas `/api/` fallan y debe completarse la conexión al backend.

## Alcance del diagnóstico

El archivo recibido termina durante la construcción de imagen: no incluye imagen exportada, contenedor arrancado ni verificación final de salud. No demuestra un despliegue exitoso ni permite afirmar un error de memoria/disco. El mensaje inicial `No such container` corresponde a la limpieza del auxiliar, no a la compilación Angular.

Al consultar los dominios proporcionados desde esta revisión, Cloudflare devolvió `403` con la página `Just a moment...`, incluso para health y CSRF. Esto impide comprobar desde aquí el estado real del origen; no se cambiaron reglas de Cloudflare.

Referencia oficial: https://coolify.io/docs/applications/builds/overview
