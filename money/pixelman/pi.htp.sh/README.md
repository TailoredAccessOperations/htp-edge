# pi.htp.sh - Dockerized Raspberry Pi Dashboard

This repository contains a Dockerized version of the pi.htp.sh website that shows Raspberry Pi statistics with live-updating dashboard.

## Features

- Multi-stage Docker build for optimized image size
- Serves static files with nginx
- Provides mock JSON endpoints for dashboard functionality
- Ready for deployment with Cloudflare Tunnel or ngrok

## Quick Start

### Using Docker directly

```bash
# Build the image
docker build -t pi-dashboard .

# Run the container
docker run -d -p 8080:80 --name pi-dashboard pi-dashboard

# Open in browser: http://localhost:8080
```

### Using Docker Compose

```bash
# Start the service
docker-compose up -d

# Open in browser: http://localhost:8080

# Stop the service
docker-compose down
```

## Multi-Stage Build Explained

This Dockerfile uses a multi-stage build:

1. **Builder Stage** (`node:18-alpine`): 
   - Prepares and optimizes the application files
   - Copies all source files

2. **Production Stage** (`nginx:alpine`):
   - Uses a minimal nginx base image
   - Copies only the optimized files from the builder stage
   - Results in a smaller, more secure final image

## Deployment Options

### Option 1: Cloudflare Tunnel (Recommended)

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)
2. Authenticate: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create pi-dashboard`
4. Route traffic: `cloudflared tunnel route dns pi-dashboard pi.htp.sh`
5. Run the tunnel: `cloudflared tunnel run pi-dashboard`

### Option 2: ngrok

1. Install ngrok: https://ngrok.com/download
2. Authenticate: `ngrok config add-authtoken YOUR_TOKEN`
3. Start ngrok: `ngrok http 8080`
4. Use the provided HTTPS URL

## Configuration

The nginx configuration includes mock JSON endpoints that return sample data to make the dashboard fully functional:
- `/stats.json` - System statistics (CPU, memory, disk, network)
- `/uptime.json` - Uptime and availability data
- `/speedtest.json` - Network speed test results
- `/hits.json` - Page view statistics
- `/health` - Simple health check endpoint

## Customization

To use real data instead of mock data:
1. Replace the mock JSON endpoints in `nginx.conf` with actual data sources
2. Mount a volume containing real data files
3. Or modify the container to run a data collector service

## Image Size

The multi-stage build keeps the final image size small (~20MB) by:
- Using alpine-based images
- Only copying necessary files in the final stage
- Separating build-time dependencies from runtime dependencies

## Maintenance

- View logs: `docker logs pi-dashboard`
- Restart: `docker restart pi-dashboard`
- Update: Rebuild and recreate the container