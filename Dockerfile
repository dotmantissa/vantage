FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci && npm --prefix frontend ci
COPY . .
ARG VITE_PRIVY_APP_ID
ARG VITE_VANTAGE_NETWORK=studionet
ENV VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID VITE_VANTAGE_NETWORK=$VITE_VANTAGE_NETWORK
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/backend ./backend
COPY --from=build /app/shared ./shared
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/scripts/migrate-v2.mjs ./scripts/migrate-v2.mjs
EXPOSE 3001
CMD ["node","backend/src/server.js"]
