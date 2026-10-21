FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
FROM nginx:1.28-alpine
RUN apk add --no-cache ca-certificates
COPY --from=build /app/dist/farmacia-web/browser /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 scripts/validate-upstream.sh /docker-entrypoint.d/15-validate-upstream.sh
ENV API_UPSTREAM=http://api:8080
ENV NGINX_ENVSUBST_FILTER="^API_UPSTREAM$"
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
