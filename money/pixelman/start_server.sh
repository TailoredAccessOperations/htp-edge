#!/bin/bash

# E8 Lattice Web Server Startup Script
# Starts 4 backend servers + nginx load balancer

set -e

PROJECT_DIR="/Users/piv/PixelMan"
NGINX_CONF="$PROJECT_DIR/nginx/nginx.conf"
LOG_DIR="$PROJECT_DIR/logs"
BIN_DIR="$PROJECT_DIR/bin"

mkdir -p "$LOG_DIR"

echo "=== Starting E8 Lattice Web Server ==="
echo "Project: $PROJECT_DIR"

# Kill any existing processes
echo "Stopping existing servers..."
pkill -f "e8_http_server" 2>/dev/null || true
pkill -f "target/release/btc-mempool" 2>/dev/null || true
pkill -f "nginx.*$NGINX_CONF" 2>/dev/null || true
sleep 1

# Start 4 backend servers on ports 8081-8084
echo "Starting backend servers..."
for port in 8081 8082 8083 8084; do
    "$BIN_DIR/e8_http_server" $port > "$LOG_DIR/server${port}.log" 2>&1 &
    PID=$!
    echo "  Started server on port $port (PID: $PID)"
    sleep 0.2
done

# Start BTC mempool backend on port 8085 (proxied by nginx at /api/btc/)
BTC_BIN="$PROJECT_DIR/projects/btc-mempool/target/release/btc-mempool"
if [ -x "$BTC_BIN" ]; then
    echo "Starting BTC mempool backend on port 8085..."
    PORT=8085 "$BTC_BIN" > "$LOG_DIR/btc-mempool.log" 2>&1 &
    BTC_PID=$!
    echo "  Started btc-mempool (PID: $BTC_PID)"
else
    echo "  ! btc-mempool binary not found at $BTC_BIN — skipping (build with: cargo build --release)"
fi

# Wait for servers to be ready
echo "Waiting for servers to start..."
sleep 2

# Verify servers
for port in 8081 8082 8083 8084; do
    if curl -s "http://localhost:$port/health" > /dev/null; then
        echo "  ✓ Server on port $port is healthy"
    else
        echo "  ✗ Server on port $port failed to start"
        exit 1
    fi
done

if curl -s "http://localhost:8085/api/mempool" > /dev/null; then
    echo "  ✓ BTC mempool backend on port 8085 is healthy"
fi

# Start nginx
echo "Starting nginx load balancer..."
/Users/piv/.homebrew/opt/nginx/bin/nginx -c "$NGINX_CONF" -p "$PROJECT_DIR/nginx/"

sleep 1

if curl -s "http://localhost:8080/health" > /dev/null; then
    echo "  ✓ Nginx load balancer is healthy"
else
    echo "  ✗ Nginx failed to start"
    exit 1
fi

echo ""
echo "=== E8 Lattice Web Server Running ==="
echo "Frontend:     http://localhost:8080"
echo "API (LB):     http://localhost:8080/api/"
echo "E8 API:       http://localhost:8080/api/e8/"
echo "BTC API:      http://localhost:8080/api/btc/"
echo "Health:       http://localhost:8080/health"
echo ""
echo "Backend servers:"
for port in 8081 8082 8083 8084; do
    echo "  http://localhost:$port"
done
echo "  BTC mempool: http://localhost:8085"
echo ""
echo "Logs: $LOG_DIR"
echo ""
echo "Press Ctrl+C to stop all servers"

# Keep script running and show logs
tail -f "$LOG_DIR"/*.log