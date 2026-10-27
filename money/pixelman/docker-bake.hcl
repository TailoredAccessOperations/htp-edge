group "default" {
  targets = ["e8-server", "btc-mempool"]
}

group "all" {
  targets = ["e8-server", "btc-mempool", "nginx"]
}

target "e8-server" {
  dockerfile = "docker/e8-server/Dockerfile"
  context    = "."
  tags = [
    "pixelman-e8-server:latest"
  ]
  platforms = ["linux/amd64", "linux/arm64"]
  cache-from = ["type=gha"]
  cache-to   = ["type=gha,mode=max"]
}

target "btc-mempool" {
  dockerfile = "docker/btc-mempool/Dockerfile"
  context    = "."
  tags = [
    "pixelman-btc-mempool:latest"
  ]
  platforms = ["linux/amd64", "linux/arm64"]
  cache-from = ["type=gha"]
  cache-to   = ["type=gha,mode=max"]
}

target "nginx" {
  dockerfile = "docker/nginx/Dockerfile"
  context    = "docker/nginx"
  tags = [
    "pixelman-nginx:latest"
  ]
  platforms = ["linux/amd64", "linux/arm64"]
  cache-from = ["type=gha"]
  cache-to   = ["type=gha,mode=max"]
}
