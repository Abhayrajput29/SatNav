# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV="production" \
    HOST="0.0.0.0" \
    PORT="3000" \
    SATNAV_GDELT_CACHE_PATH="/var/lib/satnav/gdelt-v1.json"
WORKDIR /app
RUN groupadd --gid 10001 satnav \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin satnav \
    && mkdir -p /var/lib/satnav \
    && chown -R satnav:satnav /var/lib/satnav
COPY --from=production-dependencies --chown=satnav:satnav /app/node_modules ./node_modules
COPY --from=build --chown=satnav:satnav /app/dist ./dist
COPY --chown=satnav:satnav package.json ./package.json
USER satnav
VOLUME ["/var/lib/satnav"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
