# Use official Node.js LTS image
FROM node:20-alpine

WORKDIR /app

# Copy package definitions
COPY package*.json ./

# Install all dependencies (needed for build)
RUN npm install

# Copy application source code
COPY . .

# Build the Vite frontend into dist/
RUN npm run build

# Expose port (default 3000)
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Run the full-stack server
CMD ["npm", "start"]
