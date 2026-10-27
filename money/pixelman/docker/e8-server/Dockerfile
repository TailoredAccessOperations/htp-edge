# Builder stage: compile C source
FROM gcc:13-bookworm AS builder
WORKDIR /app
COPY src/ ./src/
RUN gcc -O2 -Wall -o e8_http_server src/e8_http_server.c src/e8.c -lm -lpthread && \
    strip e8_http_server

# Runtime stage: minimal image
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
COPY --from=builder /app/e8_http_server .
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8081/health || exit 1
CMD ["./e8_http_server", "8081"]
