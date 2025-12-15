FROM node:20-alpine

# Install build dependencies needed for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (this will build better-sqlite3 for Alpine)
RUN npm ci --only=production=false

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create data directory for SQLite database
RUN mkdir -p data

# Remove dev dependencies to reduce image size (keep build tools as better-sqlite3 may need them at runtime)
RUN npm prune --production

EXPOSE 4000

CMD ["node", "dist/index.js"]