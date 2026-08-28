# syntax=docker/dockerfile:1.7
# Build context is the repository root: docker build -f deploy/Dockerfile .

FROM oven/bun:1.4-alpine AS build
WORKDIR /src
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps apps
COPY packages packages
RUN bun run build

# The API is one bundled file (bun build --target=bun), so the runtime image carries
# no node_modules: dist/, the migrations next to it, and the built SPA under /app/web.
FROM oven/bun:1.4-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    TESTATE_DATA_DIR=/data \
    TESTATE_BASE_PATH=/
WORKDIR /app
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD sh -c 'wget -q --spider "http://127.0.0.1:${PORT}${TESTATE_BASE_PATH%/}/api/v1/health/live"'
STOPSIGNAL SIGTERM
CMD ["bun", "dist/index.js"]
