# syntax=docker/dockerfile:1.7
#
# Satu Dockerfile, lima target:
#   api     — NestJS /v1 (port 3001)
#   worker  — poller PostgreSQL (tanpa port)
#   admin   — panel Next.js (port 3002)
#   migrate — one-shot runner migrasi (dipakai `docker compose run --rm migrate`)
#   railway — image gabungan untuk Railway (api + worker + admin, lihat docs)
#
# Alasan memisahkan target, bukan satu image besar: panel butuh `.next` + Next,
# API butuh `dist/api`, worker hanya butuh `dist/worker`. Dependency produksi
# dipasang sekali di `prod-deps` lalu dipakai bersama.
#
# Build panel menerima ARG karena `NEXT_PUBLIC_*` dan `MEDIA_PUBLIC_BASE_URL`
# di-inline saat `next build` (dibaca juga oleh middleware CSP). Mengubahnya
# setelah build tidak berpengaruh — image panel harus dibangun ulang.

# Dipatok ke Node 24 karena `package-lock.json` dibuat oleh npm 11 (Node 24).
# `node:22` membawa npm 10 yang menolak lock ini (`npm ci` → EUSAGE), jadi
# dev, CI, dan image harus memakai major npm yang sama.
ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_PROGRESS=false

# ------------------------------------------------------- deps (build)
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci

# ------------------------------------------ build backend + migrasi
FROM deps AS build
COPY tsconfig.base.json tsconfig.api.json ./
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY libs ./libs
COPY scripts ./scripts
COPY db ./db
RUN npm run build:api && npm run build:worker

# ------------------------------------------------------- build panel
FROM deps AS admin-build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ARG NEXT_PUBLIC_USE_MOCK=false
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG MEDIA_PUBLIC_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_USE_MOCK=${NEXT_PUBLIC_USE_MOCK} \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID} \
    MEDIA_PUBLIC_BASE_URL=${MEDIA_PUBLIC_BASE_URL}
COPY tsconfig.base.json ./
COPY apps/admin ./apps/admin
RUN npm -w apps/admin run build

# --------------------------------------------- dependency produksi
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci --omit=dev

# ---------------------------------------------------------- runtime API
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/api ./dist/api
COPY --from=build /app/package.json ./package.json
# tsc tidak menulis ulang alias `@tarlink/*`; hook ini memetakannya ke dist.
COPY --from=build /app/scripts/alias-hook.js ./scripts/alias-hook.js
# Bootstrap admin pertama dijalankan dari image ini (lihat docs/DEPLOYMENT.md).
COPY --from=build /app/scripts/seed-admin.mjs ./scripts/seed-admin.mjs
# Volume di-mount di atas kedua direktori ini; pemiliknya harus bisa ditulis
# proses non-root saat volume masih kosong.
RUN mkdir -p storage/uploads storage/private && chown -R node:node storage
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "-r", "./scripts/alias-hook.js", "dist/api/apps/api/src/main.js"]

# ---------------------------------------------------------- runner migrasi
# Memakai image API (sudah memuat `dist/api/scripts/migrate-cli.js`) supaya
# migrasi dijalankan artefak yang sama dengan yang dideploy, tanpa devDeps.
FROM api AS migrate
# Runner membaca `db/migrations/*.sql` relatif terhadap WORKDIR (/app).
COPY --from=build /app/db ./db
ENTRYPOINT ["node", "dist/api/scripts/migrate-cli.js"]
CMD []

# ------------------------------------------------------------- worker
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/worker ./dist/worker
COPY --from=build /app/package.json ./package.json
# Worker menyelesaikan tick yang sedang berjalan sebelum keluar (lihat main.ts),
# jadi beri waktu lebih dari interval tick.
STOPSIGNAL SIGTERM
USER node
CMD ["node", "dist/worker/apps/worker/src/main.js"]

# -------------------------------------------------------------- panel
FROM ${NODE_IMAGE} AS admin
ENV NODE_ENV=production \
    PORT=3002
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=admin-build /app/apps/admin/package.json ./apps/admin/package.json
COPY --from=admin-build /app/apps/admin/next.config.mjs ./apps/admin/next.config.mjs
COPY --from=admin-build /app/apps/admin/postcss.config.mjs ./apps/admin/postcss.config.mjs
COPY --from=admin-build /app/apps/admin/tailwind.config.ts ./apps/admin/tailwind.config.ts
COPY --from=admin-build /app/apps/admin/.next ./apps/admin/.next
# `next start` menulis cache ISR ke `.next/cache`; proses non-root harus pemilik.
RUN chown -R node:node /app/apps/admin/.next
WORKDIR /app/apps/admin
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "-p", "3002", "-H", "0.0.0.0"]

# ------------------------------------------------- runtime gabungan (Railway)
# Railway memilih Dockerfile, bukan target stage. Satu image dipakai untuk tiga
# service (api, worker, admin) dengan start command berbeda; lihat
# docs/DEPLOY-RAILWAY.md. Migrasi berjalan sebagai pre-deploy command, karena
# itu `db/` ikut disalin. Stage ini tidak dipakai docker-compose.prod.yml.
FROM api AS railway
USER root
COPY --from=build /app/dist/worker ./dist/worker
COPY --from=build /app/db ./db
COPY --from=admin-build /app/apps/admin/package.json ./apps/admin/package.json
COPY --from=admin-build /app/apps/admin/next.config.mjs ./apps/admin/next.config.mjs
COPY --from=admin-build /app/apps/admin/postcss.config.mjs ./apps/admin/postcss.config.mjs
COPY --from=admin-build /app/apps/admin/tailwind.config.ts ./apps/admin/tailwind.config.ts
COPY --from=admin-build /app/apps/admin/.next ./apps/admin/.next
# Role dispatcher: api/worker/admin/migrate lewat TARLINK_SERVICE.
COPY --from=build /app/scripts/railway-start.mjs ./scripts/railway-start.mjs
RUN chown -R node:node /app/apps/admin/.next /app/dist/worker /app/db
USER node
CMD ["node", "./scripts/railway-start.mjs"]
