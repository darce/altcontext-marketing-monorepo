# -- Stage 1: build --
FROM node:22-slim AS build

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# -- Stage 2: production --
FROM node:22-slim AS production

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled JS
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

# Cap V8 heap at 192MB to leave room for OS + native allocations within 256MB VM
CMD ["node", "--max-old-space-size=192", "dist/server.js"]
