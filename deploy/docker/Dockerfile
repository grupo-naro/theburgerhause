# syntax=docker/dockerfile:1
# The Burger House: imagen de la app (Next.js). Contexto de build = /opt/theburgerhouse.
FROM node:22-bookworm-slim AS deps
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TZ=America/Argentina/Buenos_Aires
RUN corepack enable && install -d -o node -g node /app
WORKDIR /app
COPY --chown=node:node repo/ ./
USER node
RUN corepack install
RUN pnpm install --frozen-lockfile

# `next build` pre-renderiza el menú: necesita la base migrada y accesible. DATABASE_URL entra como
# secreto de BuildKit (no queda en la imagen); el build corre con network=host contra la IP del contenedor db.
FROM deps AS app
RUN --mount=type=secret,id=database_url,env=DATABASE_URL,uid=1000 \
    SESSION_SECRET=build-only-not-a-real-secret-0123456789abcdef UPLOAD_DIR=/tmp/uploads pnpm build
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
