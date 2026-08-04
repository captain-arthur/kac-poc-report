#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
for f in "$ROOT"/teleport/*-ns-*.yaml; do
  tctl create -f "$f" --insecure --force
done
tctl create -f "$ROOT/teleport/users.yaml" --insecure --force
echo "Teleport roles/users applied. Sign kubeconfigs via README if needed."
