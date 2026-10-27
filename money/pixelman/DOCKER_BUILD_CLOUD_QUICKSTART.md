# Docker Build Cloud CI/CD Quick Start

## 🚀 Setup (5 minutes)

### 1. Prerequisites
- Docker installed locally
- GitHub account with repository push access
- Docker Hub account with Pro or Business plan

### 2. Enable Docker Build Cloud

```bash
# Log in to Docker Hub
docker login

# Verify Docker Build Cloud is available
docker buildx ls
```

### 3. Configure GitHub Secrets

Go to your repository **Settings** → **Secrets and variables** → **Actions**

Add two secrets:
- `DOCKERHUB_USERNAME`: Your Docker Hub username
- `DOCKERHUB_TOKEN`: Your Docker Hub access token

[How to create access token →](https://docs.docker.com/docker-hub/access-tokens/)

### 4. Push to Trigger Build

The workflows auto-trigger on push to `main` or `develop`:

```bash
git add .
git commit -m "Setup Docker Build Cloud CI/CD"
git push origin main
```

## 📊 Monitor Builds

1. Go to **Actions** tab in your GitHub repository
2. Click on **Docker Build Cloud CI/CD**
3. Watch the build progress in real-time

## 🛠 Local Development

### Quick Build
```bash
make build
```

### Run Tests
```bash
make test
```

### Start Stack
```bash
make up
docker compose logs -f
```

### Stop Stack
```bash
make down
```

## 📦 Build Options

### Build All Services
```bash
docker buildx bake
```

### Build Specific Service
```bash
docker buildx bake e8-server
```

### Multi-Platform Build
```bash
docker buildx bake --push
```

### Load to Docker
```bash
docker buildx bake --load
```

## 🚢 Production Deployment

### Using Environment Variables
```bash
export REGISTRY=docker.io
export DOCKERHUB_USERNAME=your-username
export IMAGE_TAG=v1.0.0

docker compose -f docker-compose.prod.yml up -d
```

### Using GitHub Actions
1. Go to **Actions** → **Deploy with Docker Compose**
2. Click **Run workflow**
3. Select **production** environment

## 📈 Workflow Features

### ✓ Multi-Platform Builds
- Builds for both `linux/amd64` and `linux/arm64`
- Optimized for cloud deployments

### ✓ Build Caching
- GitHub Actions cache reduces build time by 60%+
- Automatic layer caching between runs
- Inline cache in image metadata

### ✓ Automated Testing
- Validates docker-compose.yml
- Tests container startup
- Checks image sizes
- Lints Dockerfiles

### ✓ Integration Tests
- Runs on every push to main/develop
- Tests image builds and startups
- Validates compose configuration

### ✓ Deployment Tracking
- GitHub deployment status
- Integration with GitHub environments
- Automatic rollback capability

## 🔍 View Build Artifacts

### Check Image Sizes
```bash
docker images | grep pixelman
```

### Inspect Image Layers
```bash
docker history pixelman-e8-server:latest
```

### View Build Cache
```bash
docker buildx du
```

## ⚡ Performance Tips

1. **Use .dockerignore** to reduce context size
2. **Order Dockerfile instructions** from least to most changing
3. **Use multi-stage builds** to keep runtime images small
4. **Cache busting** - push changes get automatic fresh layers

## 🔑 Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Docker Hub account username |
| `DOCKERHUB_TOKEN` | Docker Hub personal access token |

## 📝 Files Added

- `.github/workflows/docker-build-cloud.yml` - Main CI/CD workflow
- `.github/workflows/deploy.yml` - Deployment workflow
- `.github/workflows/test.yml` - Integration tests
- `docker-bake.hcl` - Docker Bake configuration
- `docker-compose.prod.yml` - Production composition
- `Makefile` - Local build targets
- `.env.example` - Environment template
- `DOCKER_BUILD_CLOUD_SETUP.md` - Detailed setup guide
- `DOCKER_BUILD_CLOUD_QUICKSTART.md` - This file

## 🆘 Troubleshooting

### Builds not triggering?
- Check branch name (should be `main` or `develop`)
- Verify file paths match workflow triggers
- Check GitHub Actions is enabled

### Authentication failing?
- Verify `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` in secrets
- Check token has read/write permissions
- Try `docker login` locally first

### Image size too large?
- Review `.dockerignore` - exclude more files
- Check for unnecessary dependencies
- Use `strip` command on binaries

## 📚 Learn More

- [Docker Build Cloud Docs](https://docs.docker.com/build/cloud/)
- [Docker Bake Reference](https://docs.docker.com/engine/reference/commandline/buildx_bake/)
- [GitHub Actions Docker](https://github.com/docker/build-push-action)
- [Multi-Platform Builds](https://docs.docker.com/build/building/multi-platform/)

---

**Next Steps:**
- [ ] Add Docker Hub secrets to GitHub
- [ ] Trigger first build by pushing to main
- [ ] Verify images appear in Docker Hub
- [ ] Deploy to production using compose
- [ ] Monitor CI/CD pipeline

Happy building! 🎉
