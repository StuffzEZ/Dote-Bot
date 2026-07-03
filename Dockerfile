FROM node:22-bookworm-slim AS build

WORKDIR /app

# Build deps for native modules (@discordjs/opus, sodium-native)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# ---- Runtime stage: slimmer image without build toolchain ----
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsodium23 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src

ENV NODE_ENV=production

CMD ["node", "src/index.js"]