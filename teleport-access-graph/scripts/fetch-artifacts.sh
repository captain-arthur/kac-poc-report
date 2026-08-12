#!/usr/bin/env bash
# Run on a machine WITH internet / Helm repo / registry access.
# 1) Ensures local Helm charts
# 2) Pulls upstream images (linux/amd64) and (re)pushes to qlqjs90/*
# 3) Optionally saves *.tar under artifacts/ (SAVE_TAR=true)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/versions.env"

ARTIFACTS="${ARTIFACTS:-$ROOT/artifacts}"
CHARTS="$ROOT/charts"
SAVE_TAR="${SAVE_TAR:-false}"
PUSH_MIRROR="${PUSH_MIRROR:-true}"
PLATFORM="${PLATFORM:-linux/amd64}"
mkdir -p "$ARTIFACTS" "$CHARTS"

echo "==> Ensuring Helm charts in $CHARTS"
if [[ ! -f "$CHARTS/teleport-access-graph-${ACCESS_GRAPH_VERSION}.tgz" ]]; then
  helm repo add teleport https://charts.releases.teleport.dev 2>/dev/null || true
  helm repo update teleport
  helm pull teleport/teleport-access-graph --version "$ACCESS_GRAPH_VERSION" -d "$CHARTS"
fi
if [[ ! -f "$CHARTS/teleport-cluster-${TELEPORT_CLUSTER_CHART_VERSION}.tgz" ]]; then
  helm repo add teleport https://charts.releases.teleport.dev 2>/dev/null || true
  helm repo update teleport
  helm pull teleport/teleport-cluster --version "$TELEPORT_CLUSTER_CHART_VERSION" -d "$CHARTS"
fi

UP_AG="${UPSTREAM_ACCESS_GRAPH_IMAGE}:${ACCESS_GRAPH_VERSION}"
UP_TP="${UPSTREAM_TELEPORT_IMAGE}:${TELEPORT_CLUSTER_CHART_VERSION}"
UP_PG="${UPSTREAM_POSTGRES_IMAGE}"
MIRROR_AG="${ACCESS_GRAPH_IMAGE}:${ACCESS_GRAPH_VERSION}"
MIRROR_TP="${TELEPORT_IMAGE}:${TELEPORT_CLUSTER_CHART_VERSION}"
MIRROR_PG="${POSTGRES_IMAGE}"

echo "==> Pull upstream (${PLATFORM})"
docker pull --platform "$PLATFORM" "$UP_AG"
docker pull --platform "$PLATFORM" "$UP_TP"
docker pull --platform "$PLATFORM" "$UP_PG"

docker tag "$UP_AG" "$MIRROR_AG"
docker tag "$UP_TP" "$MIRROR_TP"
docker tag "$UP_PG" "$MIRROR_PG"

if [[ "$PUSH_MIRROR" == "true" ]]; then
  echo "==> Push mirrors to Docker Hub"
  docker push "$MIRROR_AG"
  docker push "$MIRROR_TP"
  docker push "$MIRROR_PG"
fi

if [[ "$SAVE_TAR" == "true" ]]; then
  echo "==> Saving tars to $ARTIFACTS"
  docker save "$MIRROR_AG" -o "$ARTIFACTS/access-graph-${ACCESS_GRAPH_VERSION}.tar"
  docker save "$MIRROR_TP" -o "$ARTIFACTS/teleport-distroless-${TELEPORT_CLUSTER_CHART_VERSION}.tar"
  docker save "$MIRROR_PG" -o "$ARTIFACTS/postgres-16-alpine.tar"
fi

cat > "$ARTIFACTS/MANIFEST.txt" <<EOF
fetched_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
platform=$PLATFORM
upstream:
  - $UP_AG
  - $UP_TP
  - $UP_PG
mirror:
  - $MIRROR_AG
  - $MIRROR_TP
  - $MIRROR_PG
charts:
  - charts/teleport-access-graph-${ACCESS_GRAPH_VERSION}.tgz
  - charts/teleport-cluster-${TELEPORT_CLUSTER_CHART_VERSION}.tgz
EOF

echo "==> Done"
echo "  $MIRROR_AG"
echo "  $MIRROR_TP"
echo "  $MIRROR_PG"
cat "$ARTIFACTS/MANIFEST.txt"
