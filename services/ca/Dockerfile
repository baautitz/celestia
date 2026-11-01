# Imagem `celestia-ca`: a autoridade certificadora. Construa da raiz do repositório:
#   docker build -f services/ca/Dockerfile -t celestia-ca .
FROM node:24-slim AS build
ENV PNPM_STORE_DIR=/pnpm/store
RUN corepack enable
WORKDIR /repo
# As dependências só dependem do lockfile: esta camada fica em cache até ele mudar.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --store-dir $PNPM_STORE_DIR
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --store-dir $PNPM_STORE_DIR --filter "@platform/ca..."
RUN pnpm --filter "@platform/ca..." run build
# O tsc não copia os .sql: a CA procura as migrations ao lado do próprio código compilado.
RUN cp -r services/ca/src/migrations services/ca/dist/migrations
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm --filter @platform/ca deploy --legacy --prod /deploy --store-dir $PNPM_STORE_DIR

FROM node:24-slim
ENV NODE_ENV=production CA_PORT=3001 CA_CERT_SOURCE=header \
  DEVICE_CA_CERT_FILE=/data/ca/ca.crt DEVICE_CA_KEY_FILE=/data/ca/ca.key
WORKDIR /app
COPY --from=build /deploy ./
COPY --from=build /repo/services/ca/dist ./dist
COPY services/ca/start.sh ./start.sh
# A chave da CA fica neste volume, nunca na imagem. O dono é definido antes do VOLUME para o volume nomeado herdá-lo.
RUN mkdir -p /data/ca && chown node:node /data/ca
VOLUME /data/ca
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.CA_PORT}/health`).then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["./start.sh"]
