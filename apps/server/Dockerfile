# Build context = repo root:  docker build -f apps/server/Dockerfile .
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
# non-secret build-time config baked into the web bundle (Cloud Build substitutions)
ARG VITE_COMMIT_SHA=""
ARG VITE_APP_VERSION=""
ARG VITE_OAUTH_CLIENT_ID=""
ARG VITE_FEEDBACK_URL=""
COPY . .
# the web app ships in this image: fail early and clearly if it is missing
RUN test -f apps/web/package.json || { echo "apps/web is missing: the web version PR must be merged before this deploy" >&2; exit 1; }
RUN pnpm install --frozen-lockfile --filter server... --filter web...
RUN pnpm --filter server build
RUN pnpm --filter web build
# only server's prod deps (ws etc.); the bundle in dist/ already inlines @rafael/protocol
RUN pnpm --filter server deploy --legacy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web
WORKDIR /app
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
USER node
EXPOSE 8080
# no HEALTHCHECK: Cloud Run ignores it, the probe is set in cloudbuild.deploy.yaml
CMD ["node", "dist/index.js"]
