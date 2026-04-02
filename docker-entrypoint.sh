#!/bin/sh
set -eu
npx prisma migrate deploy
exec node dist/src/server.js
