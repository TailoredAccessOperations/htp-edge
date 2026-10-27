#!/bin/bash
# Docker Build Cloud GitHub Secrets Setup
# Usage: ./scripts/setup-secrets.sh

set -e

echo "🔐 Docker Build Cloud GitHub Secrets Setup"
echo "=========================================="
echo ""

# Check if we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Get repo info
REPO=$(git config --get remote.origin.url | sed 's/.*[:/]\(.*\)\.git$/\1/')
OWNER=$(echo $REPO | cut -d'/' -f1)
REPO_NAME=$(echo $REPO | cut -d'/' -f2)

echo "📦 Repository: $OWNER/$REPO_NAME"
echo ""

# Prompt for Docker Hub credentials
read -p "Docker Hub Username: " USERNAME
read -sp "Docker Hub Access Token: " TOKEN
echo ""
echo ""

# Verify credentials by attempting login
echo "🔍 Verifying Docker Hub credentials..."
echo "$TOKEN" | docker login -u "$USERNAME" --password-stdin > /dev/null 2>&1 || {
    echo "❌ Error: Invalid Docker Hub credentials"
    exit 1
}
echo "✓ Credentials verified"
echo ""

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo "📝 GitHub CLI not found. Install with:"
    echo "  brew install gh"
    echo ""
    echo "Then run: gh auth login"
    echo "After that, run this script again."
    exit 1
fi

# Set GitHub secrets
echo "📝 Setting GitHub Secrets..."
echo ""

gh secret set DOCKERHUB_USERNAME --body "$USERNAME" \
    && echo "✓ DOCKERHUB_USERNAME set" || exit 1

gh secret set DOCKERHUB_TOKEN --body "$TOKEN" \
    && echo "✓ DOCKERHUB_TOKEN set" || exit 1

echo ""
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Push your code to GitHub: git push origin main"
echo "2. Check Actions tab to monitor the build"
echo "3. Verify images in Docker Hub after ~5 minutes"
echo ""
echo "View secrets: gh secret list"
echo "Update token: gh secret set DOCKERHUB_TOKEN --body 'new-token'"
