#!/bin/sh
set -e

DB_PATH="/app/data.sqlite"

# Si aucune base locale n'existe (premier demarrage du conteneur, ou
# redemarrage apres que Render ait recree le disque ephemere), on tente de
# restaurer la derniere sauvegarde depuis Backblaze B2. Si aucune sauvegarde
# n'existe encore (tout premier deploiement), la restauration echoue
# normalement : on continue avec une base neuve plutot que de planter.
if [ ! -f "$DB_PATH" ]; then
  echo "[entrypoint] Aucune base locale, tentative de restauration depuis B2..."
  litestream restore -config /etc/litestream.yml "$DB_PATH" \
    && echo "[entrypoint] Base restauree depuis B2." \
    || echo "[entrypoint] Pas de sauvegarde existante, demarrage avec une base neuve."
fi

# Lance l'appli sous surveillance de Litestream : chaque ecriture SQLite est
# repliquee en continu vers B2 pendant que le serveur tourne.
exec litestream replicate -config /etc/litestream.yml -exec "node server/server.js"
