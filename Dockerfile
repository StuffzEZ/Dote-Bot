FROM python:3.11-slim-bookworm AS whisper-stage

WORKDIR /whisper

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    faster-whisper \
    flask \
    flask-cors \
    gunicorn

COPY whisper-server.py .

# ---- Node.js build stage ----
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# ---- Runtime stage ----
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsodium23 \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-stage /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=whisper-stage /usr/local/bin /usr/local/bin
COPY --from=whisper-stage /whisper /whisper

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

EXPOSE 9000

CMD ["./entrypoint.sh"]
