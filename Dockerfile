# syntax=docker/dockerfile:1
#
# TS3 Webinterface – container image.
#   docker build -t ts3-webinterface .
#   docker run -d -p 8088:8088 -v ts3wi-data:/data -v ts3wi-backups:/backups -e TS3_QUERY_HOST=<host> ts3-webinterface
# See docker-compose.yml for the recommended setup together with the official teamspeak image.
#
# Stage 1 builds the same release package as scripts/build-release.mjs (frontend + server + runtime deps).
# It runs on the build host's architecture; all runtime dependencies are pure JavaScript, so the
# result is copied unchanged into the runtime image of the target platform (amd64/arm64).

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
ARG VERSION=""
RUN set -eu; v="${VERSION#v}"; \
    if [ -n "$v" ]; then node scripts/build-release.mjs --version "$v" --out /out; else node scripts/build-release.mjs --out /out; fi; \
    mkdir -p /app; tar -xzf /out/ts3-webinterface-latest.tar.gz -C /app --strip-components=1
WORKDIR /app
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts --loglevel=error \
    && rm -rf /root/.npm

FROM node:22-bookworm-slim
# tini: PID 1 with signal handling · curl: healthcheck · tar/bzip2/sqlite3: TS3 archives and consistent DB backups
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl ca-certificates tar bzip2 sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    # UID 9987 = the user of the official teamspeak image, so a shared TS3 volume is readable and writable
    && groupadd -g 9987 ts3web && useradd -u 9987 -g 9987 -d /data -M -s /usr/sbin/nologin ts3web \
    && mkdir -p /app /data /backups && chown ts3web:ts3web /data /backups
COPY --from=build /app /app
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8088 \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    TS3WI_CONTAINER=1 \
    TS3_CONTROL_MODE=none
USER ts3web
EXPOSE 8088
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
