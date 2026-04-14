#!/bin/sh
set -eu

# Constrain Prisma DB pooling at startup to avoid exhausting managed Postgres
# connection slots during migration + boot in small instances.
if [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL_WITH_POOL="$DATABASE_URL"

  case "$DATABASE_URL_WITH_POOL" in
    *connection_limit=*)
      ;;
    *\?*)
      DATABASE_URL_WITH_POOL="${DATABASE_URL_WITH_POOL}&connection_limit=${PRISMA_CONNECTION_LIMIT:-3}"
      ;;
    *)
      DATABASE_URL_WITH_POOL="${DATABASE_URL_WITH_POOL}?connection_limit=${PRISMA_CONNECTION_LIMIT:-3}"
      ;;
  esac

  case "$DATABASE_URL_WITH_POOL" in
    *pool_timeout=*)
      ;;
    *)
      DATABASE_URL_WITH_POOL="${DATABASE_URL_WITH_POOL}&pool_timeout=${PRISMA_POOL_TIMEOUT:-20}"
      ;;
  esac

  export DATABASE_URL="$DATABASE_URL_WITH_POOL"
fi

npx prisma migrate deploy
exec node dist/src/server.js
