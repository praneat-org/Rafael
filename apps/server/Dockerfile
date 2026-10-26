# Build context = repo root:  docker build -f apps/server/Dockerfile .
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter server...
RUN pnpm --filter server build
# only server's prod deps (ws etc.); the bundle in dist/ already inlines @rafael/protocol
RUN pnpm --filter server deploy --legacy --prod /out \
 && cp -r apps/server/dist /out/dist

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./
USER node
EXPOSE 8080
# no HEALTHCHECK: Cloud Run ignores it, the probe is set in cloudbuild.deploy.yaml
CMD ["node", "dist/index.js"]
