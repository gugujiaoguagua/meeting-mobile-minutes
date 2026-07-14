#!/usr/bin/env bash
set -euo pipefail

DOCKER_BUILDER_PRUNE_UNTIL="${DOCKER_BUILDER_PRUNE_UNTIL:-}"
DOCKER_CONTAINER_PRUNE_UNTIL="${DOCKER_CONTAINER_PRUNE_UNTIL:-72h}"
JOURNAL_VACUUM_TIME="${JOURNAL_VACUUM_TIME:-7d}"
CLEAN_DOCKER_BUILDER_CACHE="${CLEAN_DOCKER_BUILDER_CACHE:-1}"
CLEAN_STOPPED_CONTAINERS="${CLEAN_STOPPED_CONTAINERS:-0}"
CLEAN_DANGLING_IMAGES="${CLEAN_DANGLING_IMAGES:-0}"
CLEAN_UNUSED_NETWORKS="${CLEAN_UNUSED_NETWORKS:-0}"
CLEAN_JOURNAL="${CLEAN_JOURNAL:-1}"

echo "serverCacheCleanupStartedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "$CLEAN_DOCKER_BUILDER_CACHE" = "1" ]; then
  if [ -n "$DOCKER_BUILDER_PRUNE_UNTIL" ]; then
    docker builder prune -af --filter "until=$DOCKER_BUILDER_PRUNE_UNTIL" || true
  else
    docker builder prune -af || true
  fi
else
  echo "dockerBuilderPruneSkipped=true"
fi

if [ "$CLEAN_STOPPED_CONTAINERS" = "1" ]; then
  docker container prune -f --filter "until=$DOCKER_CONTAINER_PRUNE_UNTIL" || true
else
  echo "containerPruneSkipped=true"
fi

if [ "$CLEAN_DANGLING_IMAGES" = "1" ]; then
  docker image prune -f || true
else
  echo "imagePruneSkipped=true"
fi

if [ "$CLEAN_UNUSED_NETWORKS" = "1" ]; then
  docker network prune -f || true
else
  echo "networkPruneSkipped=true"
fi

if [ "$CLEAN_JOURNAL" = "1" ] && command -v journalctl >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo journalctl --vacuum-time="$JOURNAL_VACUUM_TIME" || true
else
  echo "journalVacuumSkipped=true"
fi

df -h / || true
docker system df || true

echo "serverCacheCleanupCompletedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
