#!/usr/bin/env bash
# Inicia o sistema Acella neste computador (Mac/Linux). Uso: ./iniciar.sh
cd "$(dirname "$0")/server" || exit 1
command -v node >/dev/null || { echo "Node.js não encontrado. Instale a versão 22 ou mais nova: https://nodejs.org"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Seu Node.js é antigo. Instale a versão 22 ou mais nova."; exit 1; }
echo "Iniciando o sistema Acella em http://localhost:3000 (Ctrl+C para parar)"
( sleep 2; (xdg-open http://localhost:3000/area-restrita.html || open http://localhost:3000/area-restrita.html) >/dev/null 2>&1 ) &
exec node --no-warnings server.js
