# =====================================================================
# FormReminder - Frontend Dockerfile
# Place this file at: frontend/Dockerfile
# =====================================================================

# ---- Stage 1: Build the React Vite app ----
FROM node:18-alpine AS build
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .

RUN npm run build
# ---- Stage 2: Serve compiled assets with NGINX ----
FROM nginx:alpine

# Copy compiled files from Vite build output
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom NGINX config that handles React Router (client-side routing)
# Without this, any direct URL hit (e.g. /dashboard) returns 404 from NGINX
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
