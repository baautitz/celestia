#!/bin/sh
# Só produção, dentro da imagem `celestia-ca`: qualquer falha impede o serviço de subir.
set -eu

: "${DEVICE_CA_CERT_FILE:?defina DEVICE_CA_CERT_FILE}"
: "${DEVICE_CA_KEY_FILE:?defina DEVICE_CA_KEY_FILE}"

if [ -e "$DEVICE_CA_CERT_FILE" ] && [ -e "$DEVICE_CA_KEY_FILE" ]; then
  : # CA já existe
elif [ -e "$DEVICE_CA_CERT_FILE" ] || [ -e "$DEVICE_CA_KEY_FILE" ]; then
  # Criar outra CA invalidaria todos os Dispositivos; o sintoma pode ser só um volume mal montado.
  echo "Erro: só um dos arquivos da CA existe ($DEVICE_CA_CERT_FILE, $DEVICE_CA_KEY_FILE). Restaure o backup." >&2
  exit 1
else
  node dist/cli/create-ca.js
  echo "⚠️  CA NOVA criada: Dispositivos emitidos por uma CA anterior deixam de valer. Faça backup de $DEVICE_CA_KEY_FILE."
  echo "Copie o certificado público abaixo para o Traefik (caFiles):"
  cat "$DEVICE_CA_CERT_FILE"
fi

node dist/migrate.js
exec node dist/main.js
