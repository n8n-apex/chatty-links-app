FROM node:20-alpine AS builder

WORKDIR /app

# Build argument for webhook URL
ARG VITE_N8N_WEBHOOK_URL
ENV VITE_N8N_WEBHOOK_URL=$VITE_N8N_WEBHOOK_URL

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies with npm
RUN npm install

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production image
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config for SPA routing
RUN echo 'server { \
    listen 80; \
    add_header X-Frame-Options ""; \
    add_header Content-Security-Policy "frame-ancestors *;"; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
