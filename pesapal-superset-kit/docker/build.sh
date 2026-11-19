#!/usr/bin/env bash
# Build (and optionally push) a Superset image that contains the Pesapal extensions.
#
#   ./build.sh /path/to/superset registry.example.com/pesapal/superset 5.0.0-pesapal.1 [--push]
#
# Run install.py on the source folder first.
set -euo pipefail
SRC=${1:?superset source folder}; IMAGE=${2:?image name}; TAG=${3:?tag}; PUSH=${4:-}
cd "$SRC"

echo ">> Updating superset-frontend/package-lock.json (the Docker build uses 'npm ci')"
(cd superset-frontend && npm install --package-lock-only --ignore-scripts --no-audit --no-fund)

echo ">> Building $IMAGE:$TAG (target 'lean' = production image, frontend compiled in)"
docker build --target lean -t "$IMAGE:$TAG" .

echo ">> Smoke test"
docker run --rm --entrypoint python "$IMAGE:$TAG" -c \
  "import superset.semantic.dax, superset.semantic.views; print('backend ok')"
docker run --rm --entrypoint sh "$IMAGE:$TAG" -c \
  "grep -l 'what_if_scenario' /app/superset/static/assets/*.js >/dev/null && echo 'frontend ok'"

if [ "$PUSH" = "--push" ]; then docker push "$IMAGE:$TAG"; fi
echo ">> Done: $IMAGE:$TAG"
