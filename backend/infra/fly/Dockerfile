# -- Stage 1: build backend --
FROM node:22-slim AS build-backend

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies first (cache layer)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# -- Stage 2: build dashboard --
FROM node:22-slim AS build-dashboard

WORKDIR /dashboard

COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci

COPY dashboard/ ./
RUN npm run build

# -- Stage 3: production --
FROM node:22-slim AS production

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled backend JS
COPY --from=build-backend /app/dist ./dist

# Copy pre-built dashboard (adapter-node output)
COPY --from=build-dashboard /dashboard/build ./dashboard

ENV NODE_ENV=production
EXPOSE 3000

# Cap V8 heap at 192MB to leave room for OS + native allocations within 256MB VM
CMD ["node", "--max-old-space-size=192", "dist/server.js"]
