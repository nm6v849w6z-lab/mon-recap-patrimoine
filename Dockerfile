FROM node:20-bookworm-slim

# Outils de compilation pour better-sqlite3 : filet de securite si aucun
# binaire precompile n'est disponible pour cette plateforme/version de Node.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Installe le binaire Litestream (replication continue de SQLite vers un
# stockage objet). Sans ca, la base serait perdue a chaque redemarrage du
# service sur Render, qui n'a pas de disque persistant sur son offre gratuite.
ARG LITESTREAM_VERSION=0.5.17
RUN curl -fsSL -o /tmp/litestream.tar.gz \
      "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz" \
    && tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz litestream \
    && rm /tmp/litestream.tar.gz

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm rebuild better-sqlite3

COPY . .

COPY litestream.yml /etc/litestream.yml
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
