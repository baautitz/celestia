# Imagem `celestia`: API e SPA num processo só. Construa da raiz do repositório:
#   docker build -f packages/server/Dockerfile -t celestia .
FROM node:24-slim AS build
ENV PNPM_STORE_DIR=/pnpm/store
RUN corepack enable
WORKDIR /repo
# As dependências só dependem do lockfile: esta camada fica em cache até ele mudar.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --store-dir $PNPM_STORE_DIR
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --store-dir $PNPM_STORE_DIR --filter "@platform/server..." --filter "@platform/web..."
RUN pnpm --filter "@platform/server..." --filter "@platform/web..." run build
# O tsc não copia os .sql: cada Module procura as migrations ao lado do próprio código compilado.
RUN cd packages/server/src && find . -type d -name migrations -exec cp -r --parents {} ../dist \;
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm --filter @platform/server deploy --legacy --prod /deploy --store-dir $PNPM_STORE_DIR

FROM node:24-slim
ENV NODE_ENV=production WEB_ROOT=./public PORT=3000
WORKDIR /app
COPY --from=build /deploy ./
COPY --from=build /repo/packages/server/dist ./dist
COPY --from=build /repo/packages/web/dist ./public
COPY packages/server/start.sh ./start.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["./start.sh"]
