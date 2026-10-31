#!/bin/sh
# Só produção, dentro da imagem `celestia`: qualquer falha impede o serviço de subir.
set -eu

node dist/db/migrate.js
exec node dist/index.js
