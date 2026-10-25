#!/usr/bin/env bash
# Cópia da base de dados, encriptada com uma password (AES-256, GnuPG).
# Uso: DATABASE_URL=... BACKUP_PASSWORD=... scripts/db-backup.sh [pasta]
# Precisa de Docker (usa o pg_dump da imagem oficial postgres:18) e de gpg.
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL}"
: "${BACKUP_PASSWORD:?Defina BACKUP_PASSWORD}"

OUT_DIR="${1:-backup}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y-%m-%d_%H%M)"
DUMP="$OUT_DIR/casa-ferreiro-$STAMP.dump"

# Formato "custom": comprimido e próprio para pg_restore
docker run --rm --network host -e DATABASE_URL postgres:18-alpine \
  sh -c 'pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL"' > "$DUMP"

# Confirmar que a cópia é legível antes de a guardar
TABLES="$(docker run --rm -i postgres:18-alpine pg_restore --list < "$DUMP" | grep -c ' TABLE ' || true)"
if [ "$TABLES" -lt 1 ]; then
  echo "A cópia não tem tabelas: algo correu mal." >&2
  exit 1
fi

gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$DUMP.gpg" "$DUMP" 3<<<"$BACKUP_PASSWORD"
rm -f "$DUMP"

echo "Cópia criada: $DUMP.gpg ($TABLES tabelas, $(du -h "$DUMP.gpg" | cut -f1))"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "file=$DUMP.gpg" >> "$GITHUB_OUTPUT"
  echo "name=casa-ferreiro-$STAMP" >> "$GITHUB_OUTPUT"
fi
