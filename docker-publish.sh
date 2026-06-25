#!/usr/bin/env bash
# 构建并推送 Super SSH 镜像到容器仓库
#
# 用法:
#   ./docker-publish.sh docker.io/<用户名>/super-ssh
#   ./docker-publish.sh ghcr.io/<用户名>/super-ssh
#   ./docker-publish.sh registry.cn-hangzhou.aliyuncs.com/<命名空间>/super-ssh
#
# 环境变量:
#   VERSION      镜像标签，默认 package.json 的 version
#   PLATFORMS    默认 linux/amd64
#   BUILD_ONLY=1 仅构建到本地 Docker，不推送（Docker Hub 推送失败时可用）
#
# 示例:
#   docker login
#   ./docker-publish.sh docker.io/mamingconghello/super-ssh
#   BUILD_ONLY=1 ./docker-publish.sh docker.io/mamingconghello/super-ssh
#   ./docker-publish.sh registry.cn-hangzhou.aliyuncs.com/<命名空间>/super-ssh

set -euo pipefail

cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

IMAGE_REF="${1:-}"
if [[ -z "$IMAGE_REF" ]]; then
  echo "用法: $0 <镜像名或仓库地址>"
  echo "示例: $0 docker.io/mamingconghello/super-ssh"
  echo "      BUILD_ONLY=1 $0 super-ssh:1.0.0"
  exit 1
fi

# 支持 super-ssh:1.0.0 或 repo/ns/super-ssh:1.0.0（避免 super-ssh:1.0.0:1.0.0）
IMAGE="$IMAGE_REF"
TAG_FROM_ARG=""
if [[ "$IMAGE_REF" == */* ]]; then
  last="${IMAGE_REF##*/}"
  if [[ "$last" == *:* && "$last" != *@* ]]; then
    IMAGE="${IMAGE_REF%/*}/${last%%:*}"
    TAG_FROM_ARG="${last##*:}"
  fi
elif [[ "$IMAGE_REF" == *:* && "$IMAGE_REF" != *@* ]]; then
  IMAGE="${IMAGE_REF%%:*}"
  TAG_FROM_ARG="${IMAGE_REF##*:}"
fi

VERSION="${TAG_FROM_ARG:-${VERSION:-$(node -p "require('./package.json').version")}}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
NODE_IMAGE="${NODE_IMAGE:-docker.m.daocloud.io/library/node:20-alpine}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
USE_CN_MIRROR="${USE_CN_MIRROR:-1}"
BUILD_ONLY="${BUILD_ONLY:-0}"

echo "镜像: ${IMAGE}"
echo "标签: ${VERSION}, latest"
echo "平台: ${PLATFORMS}"
echo "基础镜像: ${NODE_IMAGE}"
echo "模式: $([[ "$BUILD_ONLY" == "1" ]] && echo '仅构建（不推送）' || echo '构建并推送')"
echo ""

if [[ "$IMAGE" == docker.io/* ]] && [[ "$BUILD_ONLY" != "1" ]]; then
  echo "提示: 国内推送 Docker Hub 常因 auth.docker.io 超时失败。"
  echo "      可改用阿里云: ./docker-publish.sh registry.cn-hangzhou.aliyuncs.com/<命名空间>/super-ssh"
  echo "      或先本地构建: BUILD_ONLY=1 $0 ${IMAGE}"
  echo ""
fi

build_args=(
  --build-arg "NODE_IMAGE=${NODE_IMAGE}"
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY}"
  --build-arg "USE_CN_MIRROR=${USE_CN_MIRROR}"
  -t "${IMAGE}:${VERSION}"
  -t "${IMAGE}:latest"
)

if [[ "$BUILD_ONLY" == "1" ]]; then
  if [[ "$PLATFORMS" != "linux/amd64" ]]; then
    echo "BUILD_ONLY 模式仅支持 PLATFORMS=linux/amd64" >&2
    exit 1
  fi
  docker build "${build_args[@]}" .
  echo ""
  echo "已构建到本地:"
  echo "  ${IMAGE}:${VERSION}"
  echo "  ${IMAGE}:latest"
  echo ""
  echo "网络可用时再推送（需 docker login）:"
  echo "  docker push ${IMAGE}:${VERSION}"
  echo "  docker push ${IMAGE}:latest"
  exit 0
fi

docker buildx inspect super-ssh-builder >/dev/null 2>&1 \
  || docker buildx create --name super-ssh-builder --use

if ! docker buildx build \
  --platform "${PLATFORMS}" \
  "${build_args[@]}" \
  --push \
  .; then
  echo "" >&2
  echo "推送失败。国内访问 Docker Hub 常会 reset，可尝试:" >&2
  echo "  1) 阿里云: docker login registry.cn-hangzhou.aliyuncs.com" >&2
  echo "     ./docker-publish.sh registry.cn-hangzhou.aliyuncs.com/<命名空间>/super-ssh" >&2
  echo "  2) 先本地构建: BUILD_ONLY=1 $0 ${IMAGE}" >&2
  echo "     开 VPN 后: docker push ${IMAGE}:${VERSION}" >&2
  exit 1
fi

echo ""
echo "已推送:"
echo "  ${IMAGE}:${VERSION}"
echo "  ${IMAGE}:latest"
echo ""
echo "拉取运行:"
echo "  docker run -d -p 3000:3000 --name super-ssh ${IMAGE}:${VERSION}"
