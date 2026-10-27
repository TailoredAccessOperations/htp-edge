# Docker Build Cloud Setup

## Prerequisites

1. Docker Hub account with active subscription
2. GitHub repository with admin access
3. Docker Build Cloud enabled on Docker Hub

## Step 1: Enable Docker Build Cloud

1. Go to [Docker Hub](https://hub.docker.com)
2. Navigate to **Builds** → **Cloud Builders**
3. Click **Enable Docker Build Cloud**
4. Follow the setup wizard to connect your GitHub account

## Step 2: Configure GitHub Secrets

Add these secrets to your GitHub repository settings:

```
DOCKERHUB_USERNAME  = your-docker-hub-username
DOCKERHUB_TOKEN     = your-docker-hub-access-token
```

To create a Docker Hub access token:
1. Go to Docker Hub → **Account Settings** → **Security**
2. Click **New Access Token**
3. Name it "GitHub Actions"
4. Grant read/write permissions
5. Copy and save to GitHub Secrets

## Step 3: Build Cache Configuration

The workflows use GitHub Actions cache with `type=gha`:

- **Automatic layer caching** across builds
- **Multi-platform builds** (linux/amd64, linux/arm64)
- **Inline cache** stored in image metadata
- **Reduced build times** on subsequent runs

## Step 4: Trigger Builds

### Automatic Triggers
- Push to `main` or `develop` branches
- Changes to `src/`, `projects/`, `web/`, `docker/`, or `docker-compose.yml`

### Manual Trigger
1. Go to **Actions** tab in GitHub
2. Select **Docker Build Cloud CI/CD**
3. Click **Run workflow**

## Step 5: Docker Bake Integration

Build locally with caching:

```bash
# Build all services
docker buildx bake

# Build specific service
docker buildx bake e8-server

# Production build
docker buildx bake prod

# With custom tag
docker buildx bake --set "*.tags=myregistry/tag:v1.0"
```

## Step 6: Production Deployment

Deploy to production using the docker-compose.prod.yml:

```bash
export REGISTRY=docker.io
export DOCKERHUB_USERNAME=your-username
export IMAGE_TAG=v1.0.0

docker compose -f docker-compose.prod.yml up -d
```

Or trigger via GitHub Actions:
1. Go to **Actions** → **Deploy with Docker Compose**
2. Click **Run workflow**
3. Select environment (staging/production)

## Build Cache Strategy

### Layer Caching
1. **Builder stages** (gcc, rust) cached separately
2. **Dependencies** cached in separate layers
3. **Source changes** only bust relevant layers
4. **Base images** pulled fresh with `--pull`

### Cache Performance
- **First build**: ~2-3 minutes
- **Subsequent builds**: ~30-60 seconds
- **Cache hit rate**: ~85% for unchanged layers

## Monitoring Builds

1. **GitHub Actions Tab**: See real-time build progress
2. **Docker Hub Builds**: Track push history and image tags
3. **Build Summary**: Check image sizes and layer count

## Troubleshooting

### Builds Failing
- Check GitHub runner logs: **Actions** → **Workflow run**
- Verify Docker Hub credentials in secrets
- Ensure `DOCKERHUB_USERNAME` matches Docker Hub account

### Cache Not Working
- GitHub Actions cache has 5GB limit per repo
- Old cache entries auto-deleted after 7 days
- Force cache clear by changing `cache-to` mode

### Image Size Issues
- Verify `.dockerignore` excludes unnecessary files
- Check multi-stage builds separate builder from runtime
- Use `strip` command to reduce binary sizes

## Performance Tips

1. **Use specific base image tags** (e.g., `gcc:13-bookworm-slim`)
2. **Order Dockerfile commands** from least to most frequently changing
3. **Combine RUN commands** to reduce layer count
4. **Use BuildKit features** with `DOCKER_BUILDKIT=1`

## Cleanup and Maintenance

### Local Build Cache
```bash
docker buildx prune --all
```

### Docker Hub Images
```bash
# Remove old tags (keep last 5)
docker pull username/pixelman-e8-server:latest
docker rmi $(docker images --filter=reference='*/pixelman-*' -q | tail -n +6)
```

### GitHub Actions Cache
- Automatically cleaned after 7 days of inactivity
- Can be manually purged in repository settings

## Advanced Configuration

### Custom Build Platforms
Edit `docker-bake.hcl` to build for additional platforms:

```hcl
platforms = [
  "linux/amd64",
  "linux/arm64",
  "linux/arm/v7"
]
```

### Build Secrets (for private repos)
```yaml
- name: Build with secrets
  uses: docker/build-push-action@v5
  with:
    secrets: |
      "git_token=${{ secrets.GIT_TOKEN }}"
```

### SBOM and Signatures
```yaml
- name: Build with attestations
  uses: docker/build-push-action@v5
  with:
    attests: |
      type=sbom
      type=provenance
```
