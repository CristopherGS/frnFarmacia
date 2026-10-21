# SG Farma · Web

Angular 21, interfaz responsive en español y moneda GTQ. Repositorio Git y Dockerfile independientes.

## Desarrollo

Para iniciar el sistema completo nativo en Windows, usar `INICIAR-LOCAL.cmd` desde la carpeta contenedora. Abre http://127.0.0.1:4200; acceso en `farmacia-infra/.local/ACCESO.txt`. No requiere Docker. Ver `farmacia-infra/LOCAL.md`.

`npm ci` y `npm run dev`. Abrir http://localhost:4200; la API debe estar en http://localhost:8080. El proxy de desarrollo mantiene la sesión y protección CSRF en el mismo origen.

Producción usa preferentemente la imagen Nginx del Dockerfile, puerto 80. `npm run dev` es solo para desarrollo (Angular CLI en 0.0.0.0:4200). `npm start` sirve el build de producción (`npm run build` antes) con `scripts/serve.mjs`: archivos estáticos con respaldo SPA, `/healthz` y proxy de `/api/` hacia `API_UPSTREAM`; escucha en `PORT` (4200 por defecto). Es la red de seguridad si Coolify usa Railpack en lugar del Dockerfile; en Coolify con Railpack, definir `PORT=80` o exponer 4200. Los iniciadores locales de Windows siguen usando Angular CLI directamente.

`npm run build` genera `dist/farmacia-web/browser`. El contenedor Nginx usa `API_UPSTREAM` para reenviar `/api/` al backend privado. En Coolify publicar con HTTPS y configurar API con `COOKIE_SECURE=true`.

## Incluido

Acceso personal; resumen operativo; alta de productos con presentaciones/códigos; proveedores; recepción de múltiples lotes; consulta de inventario y kardex; carrito POS; pago efectivo/tarjeta/transferencia (registro); apertura/cierre de caja; consulta e impresión de comprobantes internos; auditoría por permisos.

FEL no aparece en el menú. No se simulan facturas fiscales ni se incluye información ficticia como datos reales. El catálogo empieza vacío.

## Probar el flujo

1. Iniciar sesión con el administrador creado mediante variable de entorno.
2. Crear proveedor; crear producto con caja ×20, blíster ×10 y unidad ×1 y sus precios. Autorizar fraccionamiento expresamente si corresponde a la prueba.
3. Recibir 3 cajas de un lote futuro. Ver 60 unidades base en Inventario.
4. La caja abre automáticamente a las 06:00 (hora Guatemala). Dentro del horario, vender una caja, un blíster y tres unidades. Verificar salida 33 y saldo 27.
5. Revisar comprobante y Kardex. La caja cierra automáticamente a las 00:00 con efectivo esperado y arqueo físico pendiente. No necesita navegador abierto; el backend debe seguir ejecutándose.

Escáner con cámara responsive: venta, ingreso por código existente y alta de producto con código nuevo, conservando permisos y recepción por lote. ZXing se carga al activar el lector; no depende de BarcodeDetector del navegador. Incluye alternativa manual y apagado de cámara al salir. Para teléfono en la Wi-Fi local consultar `farmacia-infra/MOVIL.md`; requiere HTTPS confiable en el teléfono. `npm test -- --watch=false` ejecuta las pruebas del lector y sus flujos.

Limitaciones: altas y consultas iniciales, sin edición/devoluciones aún; PWA pendiente. Usuarios se crean mediante API por administrador (pantalla pendiente). Falta probar cámara con teléfono y envases físicos.
