FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg ca-certificates \
 && pip3 install --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# vendor must be copied first — node/package.json references it via file:../vendor/packages/node
COPY vendor/packages/node/ ./vendor/packages/node/
# Install SDK's own deps (jose) so require('jose') resolves from the real symlink target path
RUN cd vendor/packages/node && npm install --omit=dev --ignore-scripts
COPY node/package*.json ./node/
RUN cd node && npm ci --omit=dev
COPY node/ ./node/

WORKDIR /app/node
ENV PORT=8000
ENV PLUCK_DB=/tmp/pluck.db
ENV PLUCK_DL_DIR=/tmp/pluck-downloads
CMD ["npm", "start"]
