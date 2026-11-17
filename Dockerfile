# syntax=docker/dockerfile:1

# One image: the API server, which also serves the built web app (apps/web-v2) and its
# icon libraries. Build from the repo root:  docker build -t dnd-ambiance .
#
# Debian slim rather than Alpine: better-sqlite3 and sharp ship prebuilt binaries for
# glibc, so nothing native has to compile against musl.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# build: install everything, build the icon manifests, the web app and the server
FROM base AS build
# Only used if a native module has no prebuilt binary for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Manifests first, so the install layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web-v2/package.json apps/web-v2/
COPY packages/shared/package.json packages/shared/
COPY packages/audio-engine/package.json packages/audio-engine/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY scripts scripts
COPY packages packages
COPY apps/server apps/server
COPY apps/web-v2 apps/web-v2

# The icon manifests land in apps/web-v2/public/icons, which Vite copies into dist/icons.
RUN node scripts/build-icon-libraries.mjs \
  && pnpm --filter @dnd/web-v2 build \
  && pnpm --filter @dnd/server build

# A standalone copy of the server with its own node_modules.
# Dev dependencies are kept on purpose: the server still creates its tables at start
# through drizzle-kit (see ensureSchema in apps/server/src/db/index.ts). Add --prod here
# once it starts from the migrations in drizzle/ instead.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm --filter @dnd/server deploy --legacy /out

# runtime
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST=/app/web

# The server resolves `drizzle/` from its working directory.
WORKDIR /app/server
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules node_modules
COPY --from=build /out/dist dist
COPY --from=build /out/drizzle drizzle
COPY --from=build /repo/apps/web-v2/dist /app/web

# Database, audio files and images. Mount a volume here and back it up.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/index.js"]
