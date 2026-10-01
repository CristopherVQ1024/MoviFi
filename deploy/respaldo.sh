#!/usr/bin/env bash
# Copia de seguridad de la base de datos en ~/respaldos (conserva 14 días).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p ~/respaldos
docker compose exec -T db pg_dump -U movifi movifi_db | gzip > ~/respaldos/movifi-$(date +%F).sql.gz
find ~/respaldos -name 'movifi-*.sql.gz' -mtime +14 -delete
echo "Respaldo listo: ~/respaldos/movifi-$(date +%F).sql.gz"
