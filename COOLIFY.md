# Frontend en Coolify

Diagnóstico conjunto, pruebas realizadas y comandos para el servidor: [DIAGNOSTICO_DESPLIEGUE.md](DIAGNOSTICO_DESPLIEGUE.md).

Los registros recibidos muestran compilación Angular terminada, pero construcción mediante **Railpack** con Node 22 y arranque `npm run start`. Los comandos npm start y npm run dev son exclusivamente de desarrollo; producción debe usar el Dockerfile con Nginx. La versión de desarrollo escucha explícitamente en 0.0.0.0:4200.

## Configuración de esta aplicación

| Campo | Valor |
|---|---|
| Repositorio | `CristopherGS/frnFarmacia` |
| Rama | `main` |
| Build strategy / Build pack | **Dockerfile** |
| Base directory | `/` |
| Dockerfile location | `/Dockerfile` |
| Puerto interno / Ports Exposes | `80` |
| Dirección de escucha dentro del contenedor | `0.0.0.0:80` |
| Dominio | `http://med.sglabs.lat` (con `http://`: Cloudflare pone el TLS) |
| Comando de inicio, build e install personalizados | Vacíos (usar el de la imagen Nginx) |
| Healthcheck | HTTP GET, puerto 80, ruta `/healthz`, estado 200 |
| Variable de ejecución (solo **Runtime**, no Build) | `API_UPSTREAM=http://bkn-api:8080` |

`bkn-api` es el *Custom network alias* configurado en la aplicación backend (`bknFarmacia`) en Coolify. Ambas aplicaciones deben compartir la red privada de Coolify; si se cambia el alias del backend, hay que actualizar esta variable. No usar `localhost`, que dentro del frontend apunta al propio frontend.

También se admite un upstream HTTPS, por ejemplo `https://bknmed.sglabs.lat`, pero si Cloudflare protege esa ruta con un desafío interactivo el proxy no podrá autenticar usuarios. Se usa conexión privada entre frontend y backend; el navegador llama `/api/v1` en el mismo dominio del frontend.

Guardar y volver a desplegar. En el nuevo registro deben aparecer las etapas del Dockerfile (Node 24 y después Nginx), no el plan Railpack ni `ng serve`. Los archivos estáticos están en `/app/dist/farmacia-web/browser` y el Dockerfile ya los copia a Nginx.

Tiempo de build: el Dockerfile copia solo `package*.json` antes de `npm ci` y solo `angular.json`, `tsconfig*.json`, `public` y `src` antes de `ng build`, así que un cambio en documentación o en `.github` reutiliza todas las capas. La caché de npm usa BuildKit (`--mount=type=cache`). No activar *Disable build cache* en Coolify.

Si antes se configuraron los puertos 3000 o 4200, reemplazarlos por 80 para este frontend de producción. El backend sigue en 8080. Cloudflare termina el TLS y el Tunnel entrega HTTP a Traefik por el puerto 80, que reenvía al puerto interno 80 de este contenedor; no configurar 443 como puerto del proceso Nginx.

La imagen incorpora healthcheck `/healthz`. Esta comprobación confirma el servidor web; no garantiza que PostgreSQL o la API estén disponibles. El control de la API se hace aparte con `/actuator/health` en backend.

## Infraestructura SG Labs

- Servidor: CT104 `sglabs-coolify`, IP interna `192.168.0.33` (panel de Coolify normalmente en `:8000`).
- Ruta de tráfico: Cloudflare Tunnel (CT102, `*.sglabs.lat` → `http://192.168.0.33:80`) → Traefik (`coolify-proxy`) → contenedor. Por eso los dominios en Coolify llevan `http://`.
- Recursos de CT104: 4 cores, 6 GB de RAM y 2 GB de swap. Con 2 cores / 4 GB las compilaciones de Angular y Maven eran muy lentas.
- Backend: [bknFarmacia](https://github.com/CristopherGS/bknFarmacia/blob/main/COOLIFY.md), `http://bknmed.sglabs.lat`, alias de red `bkn-api`, puerto 8080.

Comprobación directa contra el origen (salta Cloudflare):

```sh
curl -i -H 'Host: med.sglabs.lat'    http://192.168.0.33/healthz
curl -i -H 'Host: bknmed.sglabs.lat' http://192.168.0.33/actuator/health
curl -i -H 'Host: med.sglabs.lat'    http://192.168.0.33/api/v1/auth/csrf   # JSON, no HTML
```

Si por HTTPS público aparece `403` con "Just a moment...", es una regla de Cloudflare (Security Events), no del servidor.

## Comprobación

1. `https://med.sglabs.lat/healthz` debe responder `ok`.
2. La raíz debe mostrar el acceso de SG Farma.
3. `/api/v1/auth/csrf` debe devolver JSON con un token, no HTML de Cloudflare, `502`, ni el HTML del frontend.
4. Iniciar sesión con el administrador del backend remoto; las credenciales locales no se trasladan a producción.

El frontend ahora puede arrancar aunque el nombre de la API todavía no resuelva; en ese caso solo las llamadas `/api/` fallan y debe completarse la conexión al backend.

Si todavía se ejecuta temporalmente `ng serve`, `angular.json` permite explícitamente `med.sglabs.lat`: se observó un 403 de Angular por dominio rechazado. Esta compatibilidad no sustituye seleccionar Dockerfile/Nginx en producción. Una comprobación posterior del backend por el proxy devolvió 404; revisar también su dominio y ruta en Coolify.

## Alcance del diagnóstico

El archivo recibido termina durante la construcción de imagen: no incluye imagen exportada, contenedor arrancado ni verificación final de salud. No demuestra un despliegue exitoso ni permite afirmar un error de memoria/disco. El mensaje inicial `No such container` corresponde a la limpieza del auxiliar, no a la compilación Angular.

Al consultar los dominios proporcionados desde esta revisión, Cloudflare devolvió `403` con la página `Just a moment...`, incluso para health y CSRF. Esto impide comprobar desde aquí el estado real del origen; no se cambiaron reglas de Cloudflare.

Referencia oficial: https://coolify.io/docs/applications/builds/overview
