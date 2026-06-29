ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE}

WORKDIR /app

# 国内构建时可加速 apk / npm（通过 build-arg 传入）
ARG NPM_REGISTRY=
ARG USE_CN_MIRROR=0

RUN if [ "$USE_CN_MIRROR" = "1" ]; then \
      sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories; \
    fi \
 && apk add --no-cache python3 make g++ wget

COPY package.json package-lock.json* ./

RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY scripts/prepare-vendor.mjs ./scripts/prepare-vendor.mjs

RUN node scripts/prepare-vendor.mjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["node", "src/server.js"]
