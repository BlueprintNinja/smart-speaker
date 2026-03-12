# ── Stage 1: Build the Vite/React app ────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# VITE_API is injected at build time so the browser knows where the backend is.
# Default: same host, port 8000. Override via --build-arg or docker-compose build args.
ARG VITE_API=http://localhost:8000
ENV VITE_API=$VITE_API

RUN npm run build

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
