#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env（使用国内镜像源），可按需修改"
fi

docker compose up -d --build "$@"

echo ""
echo "Super SSH 已启动: http://localhost:${PORT:-3000}"
