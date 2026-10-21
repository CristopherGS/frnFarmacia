# Diagnóstico y preparación de producción — 20 octubre 2026

## Evidencia y causas

- Los dos registros recibidos son de construcción del **frontend**. Muestran Railpack con Node 22.23.3 y `npm run start`/`ng serve`, aunque terminan la compilación Angular. No contienen la excepción de ejecución del backend ni prueban que los contenedores estén sanos.
- La configuración de producción estaba en `deploy`, mientras `main` aún conservaba el arranque de desarrollo. Se integró en `main`. Producción debe seleccionar Dockerfile en Coolify: cambiar el código no cambia automáticamente el build pack configurado en el panel.
- El servidor Angular de desarrollo y un puerto de destino incorrecto explican el fallo de acceso descrito. El nuevo servidor de producción escucha en `0.0.0.0:80`. `npm start` y `npm run dev` siguen escuchando en `0.0.0.0:4200` para desarrollo.
- ZXing requiere Node >=24; la imagen y CI usan Node 24. Se conservó el archivo de dependencias, sin actualizaciones masivas.
- Se confirmó `dist/farmacia-web/browser/index.html`; esa es la carpeta que copia Nginx. `proxy.conf.json` se usa únicamente en desarrollo: `localhost:8080` dentro de otro contenedor no identifica el backend.
- El backend tenía un `ApplicationRunner` que, después del arranque de Tomcat, rechazaba una base nueva sin `BOOTSTRAP_ADMIN_PASSWORD` válida. Se reprodujo ese fallo y se trasladó la inicialización después de Flyway y antes de aceptar tráfico. Esto es un defecto comprobado del código, **no prueba que sea la excepción del servidor remoto**. Falta su registro desde `Application run failed`/`Caused by`.
- Flyway administrado por Spring Boot advertía sobre PostgreSQL 18, pero las tres migraciones pasaron en PostgreSQL 18.6. Se actualizó solamente Flyway a 11.20.3 y se repitieron las pruebas; no se modificaron migraciones existentes.
- Una petición directa a `192.168.0.33:80` con los encabezados Host de ambos dominios devolvió **502**, tanto para `/healthz` del frontend como para `/actuator/health` del backend. El fallo del origen existe independientemente de Cloudflare.
- En la repetición posterior, el frontend cambió a **403** con el mensaje de Angular `This host ("med.sglabs.lat") is not allowed`, confirmando que continúa activo el servidor de desarrollo. Se añadió exclusivamente ese dominio a `serve.options.allowedHosts` como compatibilidad temporal; no se desactivó el control de hosts. El backend cambió a **404** con `404 page not found`, por lo que también debe revisarse la ruta/dominio de Traefik. Esa respuesta por sí sola no identifica si la aplicación inició correctamente.
- Las peticiones HTTPS públicas devolvieron **403** y `Cf-Mitigated: challenge`. Sin acceso al panel de Cloudflare no se puede identificar la regla ni verificar el Tunnel. No se modificaron sus protecciones.

## Cambios y validaciones

Frontend: Dockerfile multi-stage Node 24/Nginx, plantilla Nginx con SPA y proxy `/api/`, validación de `API_UPSTREAM`, certificados CA para upstream HTTPS, conservación del protocolo externo HTTPS, y mensaje visible cuando la API falla. Se eliminaron el antiguo guard de arranque y referencias a él. El lector, ventas e inventario mantienen su implementación.

Backend: conexión por variables obligatorias, escucha configurable con valor predeterminado `0.0.0.0:8080`, encabezados de proxy, health/readiness con conexión de base de datos, creación inicial del administrador transaccional sin restablecer cuentas existentes, Flyway compatible con PostgreSQL 18 y pruebas reales de arranque y autenticación. No se imprimen secretos iniciales. Java de producción sigue en 21.

Resultados locales, sin ejecutar Docker:

| Validación | Resultado |
|---|---|
| Frontend: tests y build de producción | 14 pruebas aprobadas; build aprobado |
| Backend: Maven verify y empaquetado | 22 pruebas aprobadas; BUILD SUCCESS |
| PostgreSQL temporal de integración | 18.6 real; V1, V2 y V3 aplicadas |
| Arranque con base nueva sin secreto | Rechazo controlado antes de aceptar tráfico |
| Arranque, login HTTP y reinicio con cuentas existentes | Aprobados; contraseña conservada |
| Nginx nativo 1.28, configuración equivalente a producción | Sintaxis válida y peticiones HTTP reales aprobadas |
| Nginx: raíz, ruta SPA, health, CSRF | 200; CSRF JSON; index sin caché |
| Nginx: archivo estático inexistente | 404 |
| Nginx → API: sesión, consultas, CSRF y logout | Aprobados con datos locales existentes |
| HTTPS reenviado y cookie CSRF Secure | Aprobados |
| Validador de upstream | HTTP/HTTPS válidos aceptados; URL con ruta rechazada |
| Angular de desarrollo con Host med.sglabs.lat / dominio ajeno | 200 / 403 tras reiniciar; control de hosts conservado |

La compilación local del backend usó el JDK 25 disponible con destino Java 21. CI y Dockerfile usan Java 21. Las imágenes Linux no se construyeron localmente; los workflows de GitHub realizan esa comprobación. La base local persistente no se actualizó a PostgreSQL 18 ni se borró: las pruebas de 18 usan bases temporales independientes.

Tras subir ambos proyectos, la API de GitHub Actions devolvió cero ejecuciones registradas en ambos repositorios. No se afirma que los workflows ni las imágenes hayan pasado en GitHub: comprobar que Actions esté habilitado y ejecutar los controles antes de considerar validada la imagen Linux.

## Configuración final en Coolify

Ambos repositorios: rama `main`, estrategia **Dockerfile**, directorio `/`, archivo `/Dockerfile`, comandos personalizados de build/start vacíos. Mantener las aplicaciones y PostgreSQL en la red privada `coolify`.

| Recurso | Dominio | Puerto interno | Healthcheck HTTP |
|---|---|---|---|
| Frontend | `https://med.sglabs.lat` | 80 | `/healthz` |
| Backend | `https://bknmed.sglabs.lat` | 8080 | `/actuator/health/readiness` |
| PostgreSQL | Sin dominio público | 5432 | Interno |

Frontend, variable de **ejecución**, no argumento de build:

```env
API_UPSTREAM=http://<alias-real-del-backend-en-coolify>:8080
```

No pegar el marcador literalmente. También se admite `https://bknmed.sglabs.lat`, sin ruta ni barra final, pero el desafío de Cloudflare actualmente observado impediría esa comunicación automática. La ruta privada evita ese desafío. El navegador usa `/api/v1` en el dominio del frontend, conservando sesión y CSRF sin CORS entre dominios.

Backend, variables de ejecución:

```env
DATABASE_URL=jdbc:postgresql://aitoljax7dqzmdbgydq7nlsz:5432/farmacia
DATABASE_USERNAME=<usuario-de-la-aplicacion>
DATABASE_PASSWORD=<secreto>
BOOTSTRAP_ADMIN_PASSWORD=<secreto-inicial>
PORT=8080
SERVER_ADDRESS=0.0.0.0
COOKIE_SECURE=true
```

El secreto inicial requiere mínimo 14 caracteres y máximo 72 bytes UTF-8. Solo se necesita para una base sin usuarios; no cambia la contraseña de una cuenta existente. El usuario JDBC debe poder crear y utilizar objetos en el esquema de la aplicación para Flyway. No publicar los valores reales en Git ni en diagnósticos compartidos.

En Cloudflare, verificar que cada hostname del Tunnel apunte al proxy de Coolify accesible desde `cloudflared` y conserve el Host del dominio. `localhost` depende del contenedor que ejecuta el túnel: no asumir que apunta al CT ni usar el puerto 4200. Revisar Security Events para las peticiones con desafío y aplicar, si procede, una regla específica para la API; no desactivar protecciones globales. La configuración actual del Tunnel y sus reglas sigue sin acceso de verificación.

## Comandos de verificación en CT 104

Ejecutar en el servidor; reemplazar los marcadores por nombres reales. Son consultas, no eliminan contenedores, datos ni volúmenes.

```sh
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker inspect --format '{{.State.Status}} reinicios={{.RestartCount}} redes={{json .NetworkSettings.Networks}}' <backend>
docker inspect --format '{{.State.Status}} redes={{json .NetworkSettings.Networks}}' <frontend>
docker logs --tail 150 <backend>
docker exec <backend> wget -qO- http://127.0.0.1:8080/actuator/health/readiness
docker exec <frontend> wget -qO- http://127.0.0.1/healthz
docker exec <frontend> wget -qO- http://<alias-backend>:8080/actuator/health
curl -i -H 'Host: med.sglabs.lat' http://127.0.0.1/healthz
curl -i -H 'Host: bknmed.sglabs.lat' http://127.0.0.1/actuator/health
curl -i https://med.sglabs.lat/healthz
curl -i https://bknmed.sglabs.lat/actuator/health
curl -i https://med.sglabs.lat/api/v1/auth/csrf
```

No compartir cookies/tokens emitidos por la última petición. La ruta CSRF debe devolver JSON, nunca una página HTML de desafío. No usar `/` del backend como healthcheck: es una ruta protegida, no la interfaz.

Desde psql conectado **como el usuario JDBC de la aplicación**, consultar:

```sql
SELECT current_database(), current_user, current_schema(), version();
SELECT has_database_privilege(current_user, current_database(), 'CONNECT');
SELECT has_schema_privilege(current_user, current_schema(), 'USAGE'),
       has_schema_privilege(current_user, current_schema(), 'CREATE');
SELECT version, description, success
FROM flyway_schema_history ORDER BY installed_rank;
```

Después de desplegar, repetir las consultas HTTP y comprobar que no aumenta el contador de reinicios. Iniciar sesión y consultar inventario; no crear ventas ficticias en producción.

## Pendiente remoto

Faltan los logs de ejecución completos del backend, el alias interno real, comprobar las redes y variables configuradas, ejecutar la verificación entre contenedores, y validar Traefik/Tunnel después del despliegue. Los accesos públicos continúan sin validación funcional por el desafío de Cloudflare. Este informe no declara que producción esté operativa.
