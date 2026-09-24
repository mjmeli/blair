# Stage 1: Build frontend
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
# Preserve the original hosted build's analytics without changing its deploy command.
# Self-hosted registry images explicitly override this to an empty value in CI.
ARG VITE_GA_MEASUREMENT_ID="G-3FQ78N91NB"
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:22-slim AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
RUN npx tsc

# Stage 3: Production image
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]
