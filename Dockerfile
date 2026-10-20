FROM node:24-bookworm-slim AS app
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-duckdb.mjs scripts/copy-duckdb.mjs
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
