# syntax=docker/dockerfile:1
# Build from the REPO ROOT:
#   docker build -f deploy/Dockerfile -t testate .
# The deploy-image workflow builds this "fat" image, profiles it with docker-slim,
# and publishes the slimmed result to ghcr.io.

# The version the image carries in its labels. `deploy-image.yml` passes the one in package.json
# (`bun run bump-version` keeps that in step with the API); a plain build says `local` instead of
# claiming a release. Declared before the first stage so every stage can re-declare it.
ARG VERSION=0.0.0-local

# ---- build ----
FROM oven/bun:1.4@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS build
WORKDIR /src
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Patched dependencies are an input to the install, so they have to land before it. See
# patches/README.md for what the current one fixes and when to drop it.
COPY patches patches
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps apps
COPY packages packages
RUN bun run build

# ---- runtime ----
# The API is one bundled file (bun build --target=bun) and SQLite ships inside Bun,
# so the runtime carries no node_modules: dist/, the migrations next to it, and the SPA.
FROM oven/bun:1.4-slim@sha256:e0ee68d16ccb9927bf02aa7dd8fd4bf3369ee6d46da04faa72b05ce8bfd135f6 AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="testate" \
      org.opencontainers.image.description="Git for your test database. Snapshot, checkout, diff, and import the databases behind a system under test." \
      org.opencontainers.image.source="https://github.com/PT-Perkasa-Pilar-Utama/testate" \
      org.opencontainers.image.licenses="MIT"

ARG VERSION
# The base image sets url, revision and created for itself; blanking them stops this image
# describing where oven/bun came from as though it were where Testate came from.
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.url="https://github.com/PT-Perkasa-Pilar-Utama/testate" \
      org.opencontainers.image.revision="" \
      org.opencontainers.image.created=""

ENV NODE_ENV=production \
    PORT=7378 \
    TESTATE_DATA_DIR=/data \
    TESTATE_BASE_PATH=/

COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/web/dist ./web
# The maps are for the machine that built this, not for the one running it: they are seven
# megabytes of the image, they are of no use without the sources, and a stack trace inside a
# container is read from the build output anyway.
RUN find ./dist ./web -name "*.map" -delete
RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun
VOLUME ["/data"]
EXPOSE 7378
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "const b=(Bun.env.TESTATE_BASE_PATH||'/').replace(/\/$/,'');fetch('http://127.0.0.1:'+(Bun.env.PORT||7378)+b+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["bun", "dist/index.js"]
