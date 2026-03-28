FROM node:18-alpine

WORKDIR /app

# Copy root configurations
COPY package*.json ./

# Copy workspace packages
COPY packages/shared-types ./packages/shared-types
COPY packages/ui ./packages/ui

# Copy backend app
COPY apps/backend ./apps/backend

# Install all dependencies using workspaces
RUN npm install

# Build the shared-types package first so backend can use it
RUN npm run build -w @syncstrike/shared-types

# Build the backend
RUN npm run build -w backend

# Expose the Cloud Run port
EXPOSE 8080
ENV PORT=8080

# Start the built backend
CMD ["npm", "start", "-w", "backend"]
