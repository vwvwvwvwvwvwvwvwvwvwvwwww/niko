#!/bin/sh
set -e
export NODE_ENV="${NODE_ENV:-production}"
echo "Starting niko-base on PORT=${PORT:-3000}"
exec npx tsx server.ts
