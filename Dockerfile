FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
# vite is a devDependency. A production NODE_ENV would omit it.
RUN npm ci --include=dev

COPY . .
ENV NITRO_PRESET=node-server
# npm scripts put this on PATH; a direct `node scripts/...` call does not.
ENV PATH="/app/node_modules/.bin:${PATH}"
RUN node scripts/with-app-env.mjs vite build && node scripts/patch-ssr-exports.mjs

ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

CMD ["sh", "-c", "node scripts/migrate.mjs && node .output/server/index.mjs"]
