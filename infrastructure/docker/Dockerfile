# Production images for Atlas (ADR-042). One Dockerfile, one target per
# process, built from the repository root:
#   docker build -f infrastructure/docker/Dockerfile --target api .
#   docker build -f infrastructure/docker/Dockerfile --target worker .
#   docker build -f infrastructure/docker/Dockerfile --target web \
#     --build-arg API_ORIGIN=http://api:3001 .
#   docker build -f infrastructure/docker/Dockerfile --target migrate .

FROM node:24.22.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
# The web server's proxy target is fixed when Next.js builds its routes.
ARG API_ORIGIN=http://127.0.0.1:3001
# Storage origin browsers upload to, for the content security policy.
ARG STORAGE_PUBLIC_ORIGIN=
ENV API_ORIGIN=$API_ORIGIN STORAGE_PUBLIC_ORIGIN=$STORAGE_PUBLIC_ORIGIN
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# Runs the SQL migrations once per deployment, before new versions start.
FROM build AS migrate
CMD ["pnpm", "db:migrate"]

FROM build AS prod-deps
# Drop development dependencies, reusing the store from the install above.
RUN CI=true pnpm install --prod --frozen-lockfile --offline

FROM node:24.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    LISTEN_HOST=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app /app
USER node

FROM runtime AS api
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3001/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3002/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime AS web
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["./node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
