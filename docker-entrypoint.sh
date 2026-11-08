#!/bin/sh
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$ACELLA_DATA"
  exec setpriv --reuid=node --regid=node --init-groups node --no-warnings /app/server/server.js
fi
exec node --no-warnings /app/server/server.js
