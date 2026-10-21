# Frontend en Coolify

El registro recibido muestra compilación Angular terminada, pero construcción mediante **Railpack** con Node 22 y arranque `npm run start`. En la versión de ese registro, el comando iniciaba Angular en desarrollo. En la versión actual, `npm start` termina con un mensaje de configuración: producción debe usar el Dockerfile con Nginx. Para desarrollo local usar `npm run dev`.

## Configuración de esta aplicación

| Campo | Valor |
|---|---|
| Repositorio | `CristopherGS/frnFarmacia` |
| Rama | `deploy` |
| Build strategy / Build pack | **Dockerfile** |
| Base directory | `/` |
| Dockerfile location | `/Dockerfile` |
| Puerto interno / Ports Exposes | `80` |
| Dirección de escucha dentro del contenedor | `0.0.0.0:80` |
| Dominio | `https://med.sglabs.lat` |
| Comando de inicio personalizado | Vacío (usar el de la imagen Nginx) |
| Healthcheck | HTTP, puerto 80, ruta `/healthz`, estado 200 |
| Variable de ejecución | `API_UPSTREAM=http://<nombre-interno-real-del-backend>:8080` |

El nombre entre `<...>` es un marcador: reemplazarlo por el nombre o alias real del backend en la red privada de Coolify. Ambas aplicaciones deben compartir esa red. No usar `localhost`, que dentro del frontend apunta al propio frontend. No usar el nombre de ejemplo `api` salvo que se haya configurado ese alias realmente.

También se admite un upstream HTTPS, por ejemplo `https://bknmed.sglabs.lat`, pero si Cloudflare protege esa ruta con un desafío interactivo el proxy no podrá autenticar usuarios. Se recomienda conexión privada entre frontend y backend; el navegador llama `/api/v1` en el mismo dominio del frontend.

Guardar y volver a desplegar. En el nuevo registro deben aparecer las etapas del Dockerfile (Node 24 y después Nginx), no el plan Railpack ni `ng serve`. Los archivos estáticos están en `/app/dist/farmacia-web/browser` y el Dockerfile ya los copia a Nginx.

Si antes se configuraron los puertos 3000 o 4200, reemplazarlos por 80 para este frontend de producción. El backend sigue en 8080. El dominio HTTPS llega al proxy de Coolify por 443 y el proxy reenvía al puerto HTTP interno 80; no configurar 443 como puerto del proceso Nginx.

La imagen incorpora healthcheck `/healthz`. Esta comprobación confirma el servidor web; no garantiza que PostgreSQL o la API estén disponibles. El control de la API se hace aparte con `/actuator/health` en backend.

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
