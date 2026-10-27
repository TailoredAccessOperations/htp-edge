FROM node:18-alpine AS builder
WORKDIR /app
COPY . .
RUN mkdir -p /opt/optimized && cp -r * /opt/optimized/

FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*
RUN pip install psutil

COPY --from=builder /opt/optimized/ /var/www/html/
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
# Using a simple shell command to start both
CMD ["sh", "-c", "nginx && python3 /var/www/html/stats_collector.py"]
