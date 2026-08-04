#!/usr/bin/env bash
set -euo pipefail
CTX="${KUBE_CONTEXT:-docker-desktop}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
kubectl --context="$CTX" apply -f "$ROOT/k8s/00-namespaces.yaml"
kubectl --context="$CTX" apply -f "$ROOT/k8s/01-clusterroles.yaml"
kubectl --context="$CTX" apply -f "$ROOT/k8s/02-rolebindings-payments.yaml"
kubectl --context="$CTX" apply -f "$ROOT/k8s/03-rolebindings-pe.yaml"
kubectl --context="$CTX" apply -f "$ROOT/k8s/04-sample-workloads.yaml"
echo "K8s RBAC model applied on context=$CTX"
