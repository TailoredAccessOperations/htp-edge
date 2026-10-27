FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Generate fresh lock file on Linux (no darwin binaries)
RUN pnpm install --frozen-lockfile=false 2>/dev/null || pnpm install

# Copy source and config
COPY src ./src
COPY public ./public
COPY wrangler.toml ./

# Ensure workerd binary is executable
RUN find /app/node_modules -name "workerd" -type f -exec chmod +x {} \;

EXPOSE 8787

CMD ["./node_modules/.bin/wrangler", "dev", "--local", "--ip", "0.0.0.0"]
