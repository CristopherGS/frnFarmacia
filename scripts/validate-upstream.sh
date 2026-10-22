#!/bin/sh
set -eu
if ! printf '%s' "${API_UPSTREAM:-}" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?$'; then
  echo >&2 'SG Farma: API_UPSTREAM debe ser una URL http://host:puerto o https://dominio, sin ruta, barra final ni credenciales. Configure esta variable de ejecución en Coolify.'
  exit 1
fi
if printf '%s' "$API_UPSTREAM" | grep -Eq '^https://[A-Za-z0-9-]+(:[0-9]+)?$'; then
  echo >&2 "SG Farma: API_UPSTREAM=$API_UPSTREAM usa https con un alias interno (sin puntos), que habla HTTP plano. Use http://${API_UPSTREAM#https://}"
  exit 1
fi
