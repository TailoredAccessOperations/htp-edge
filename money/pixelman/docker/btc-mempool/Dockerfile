# Builder stage: compile Rust
# rust-toolchain.toml is intentionally NOT copied (it pins nightly); we use a
# recent stable image and lock the dependency versions via Cargo.lock so the
# image build is deterministic. A lockfile-less build on an old Cargo would
# resolve 2026-era deps (some already edition 2024) and fail to compile.
FROM rust:1.90-bookworm AS builder
WORKDIR /app
COPY projects/btc-mempool/Cargo.toml .
COPY projects/btc-mempool/Cargo.lock .
COPY projects/btc-mempool/src ./src
RUN cargo build --release && \
    strip target/release/btc-mempool

# Runtime stage: minimal image
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
COPY --from=builder /app/target/release/btc-mempool .
COPY projects/btc-mempool/static ./static
ENV PORT=8082
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8082/api/mempool || exit 1
CMD ["./btc-mempool"]