#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x ./marp ]; then
  exec ./marp
fi
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) packaged="./bin/marp-v0.9.7-linux-amd64" ;;
  Linux/aarch64|Linux/arm64) packaged="./bin/marp-v0.9.7-linux-arm64" ;;
  *) packaged="" ;;
esac
if [ -n "$packaged" ] && [ -f "$packaged" ]; then
  chmod +x "$packaged"
  exec "$packaged"
fi
export GOTOOLCHAIN=go1.27.1
export CGO_ENABLED=0
go build -buildvcs=false -trimpath -ldflags="-s -w" -o ./marp ./cmd/marp
exec ./marp
