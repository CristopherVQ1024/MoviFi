#!/usr/bin/env bash
# Crea el archivo .env del despliegue con contraseñas y secretos aleatorios.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "Ya existe .env. Bórralo (rm .env) si quieres generarlo de nuevo."
  exit 1
fi

read -rp "Dominio (ej. movifi.duckdns.org): " DOMINIO
read -rp "GOOGLE_CLIENT_ID: " GOOGLE_CLIENT_ID
read -rsp "MISTRAL_API_KEY (no se muestra al escribir): " MISTRAL_API_KEY; echo
read -rp "Modelo del chat [ministral-8b-latest]: " MODELO
MODELO=${MODELO:-ministral-8b-latest}

cat > .env <<EOT
DOMINIO=$DOMINIO
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
MISTRAL_API_KEY=$MISTRAL_API_KEY
MISTRAL_CHAT_MODEL=$MODELO
EOT
chmod 600 .env
echo ".env creado."
