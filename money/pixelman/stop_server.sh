#!/bin/bash

# E8 Lattice Web Server Stop Script

echo "=== Stopping E8 Lattice Web Server ==="

# Stop nginx
echo "Stopping nginx..."
/Users/piv/.homebrew/opt/nginx/bin/nginx -s quit -c /Users/piv/PixelMan/nginx/nginx.conf -p /Users/piv/PixelMan/nginx/ 2>/dev/null || true

# Stop backend servers
echo "Stopping backend servers..."
pkill -f "e8_http_server" 2>/dev/null || true

# Stop BTC mempool backend
echo "Stopping BTC mempool backend..."
pkill -f "target/release/btc-mempool" 2>/dev/null || true

sleep 1

echo "All servers stopped."