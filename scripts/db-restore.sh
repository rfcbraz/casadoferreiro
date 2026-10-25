#!/usr/bin/env bash
# Repõe uma cópia criada por db-backup.sh. ATENÇÃO: substitui os dados da base de destino.
# Uso: DATABASE_URL=... BACKUP_PASSWORD=... scripts/db-restore.sh casa-ferreiro-AAAA-MM-DD_HHMM.dump.gpg
# Precisa de Docker (pg_restore da imagem oficial postgres:18) e de gpg.
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL (base de destino)}"
: "${BACKUP_PASSWORD:?Defina BACKUP_PASSWORD}"
FILE="${1:?Indique o ficheiro .dump.gpg}"

DUMP="$(mktemp)"
trap 'rm -f "$DUMP"' EXIT

gpg --batch --yes --quiet --pinentry-mode loopback --decrypt \
  --passphrase-fd 3 --output "$DUMP" "$FILE" 3<<<"$BACKUP_PASSWORD"

# --clean --if-exists: apaga e recria cada objeto da cópia; --single-transaction: tudo ou nada
docker run --rm -i --network host -e DATABASE_URL postgres:18-alpine \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --dbname "$DATABASE_URL"' < "$DUMP"

echo "Cópia reposta a partir de $FILE"
