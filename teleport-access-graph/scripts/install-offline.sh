#!/usr/bin/env bash
# Offline install of Teleport Access Graph (Identity Security backend) + wire Teleport Auth.
# Prerequisites:
#   - kubectl context pointing at target cluster
#   - Helm 3
#   - charts/*.tgz already present (this repo)
#   - images loaded on nodes OR pullable from private registry
#   - Teleport Enterprise with Identity Security license already running (or install separately)
#   - DOES NOT run kubectl port-forward
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/versions.env"

TELEPORT_NS="${TELEPORT_NS:-teleport}"
TELEPORT_RELEASE="${TELEPORT_RELEASE:-teleport}"
TAG_NS="${TAG_NS:-teleport-access-graph}"
TAG_RELEASE="${TAG_RELEASE:-teleport-access-graph}"
CERT_DIR="${CERT_DIR:-$ROOT/certs}"
INSTALL_POSTGRES="${INSTALL_POSTGRES:-true}"
SKIP_TELEPORT_UPGRADE="${SKIP_TELEPORT_UPGRADE:-false}"
HOST_CA_FILE="${HOST_CA_FILE:-}"

CHART_TAG="$ROOT/charts/teleport-access-graph-${ACCESS_GRAPH_VERSION}.tgz"
CHART_TP="$ROOT/charts/teleport-cluster-${TELEPORT_CLUSTER_CHART_VERSION}.tgz"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$CHART_TAG" ]] || die "missing $CHART_TAG (run scripts/fetch-artifacts.sh on a networked machine)"
command -v kubectl >/dev/null || die "kubectl not found"
command -v helm >/dev/null || die "helm not found"
command -v openssl >/dev/null || die "openssl not found"

echo "==> Namespace $TAG_NS"
kubectl get ns "$TAG_NS" >/dev/null 2>&1 || kubectl create namespace "$TAG_NS"

if [[ "$INSTALL_POSTGRES" == "true" ]]; then
  echo "==> Installing POC PostgreSQL"
  kubectl apply -f "$ROOT/manifests/postgres-poc.yaml"
  kubectl -n "$TAG_NS" rollout status deployment/teleport-access-graph-postgres --timeout=180s
  # Reuse URI from postgres secret for TAG
  POSTGRES_URI="$(kubectl -n "$TAG_NS" get secret teleport-access-graph-postgres-creds -o jsonpath='{.data.uri}' | base64 -d)"
else
  [[ -n "${POSTGRES_URI:-}" ]] || die "set POSTGRES_URI or INSTALL_POSTGRES=true"
fi

if [[ ! -f "$CERT_DIR/cert.crt" || ! -f "$CERT_DIR/cert.key" || ! -f "$CERT_DIR/ca.crt" ]]; then
  echo "==> Generating POC TLS certs"
  CERT_DIR="$CERT_DIR" "$ROOT/scripts/gen-certs.sh"
fi

echo "==> TLS + Postgres secrets for Access Graph"
kubectl -n "$TAG_NS" create secret tls teleport-access-graph-tls \
  --cert="$CERT_DIR/cert.crt" --key="$CERT_DIR/cert.key" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$TAG_NS" create secret generic teleport-access-graph-postgres \
  --from-literal="uri=${POSTGRES_URI}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> Fetch Teleport Host CA"
if [[ -n "$HOST_CA_FILE" ]]; then
  HOST_CA="$(cat "$HOST_CA_FILE")"
else
  AUTH_POD="$(kubectl -n "$TELEPORT_NS" get pod -l app.kubernetes.io/component=auth -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  [[ -n "$AUTH_POD" ]] || die "no Teleport auth pod in ns=$TELEPORT_NS; set HOST_CA_FILE=./host-ca.pem"
  # Prefer web export via auth; fall back to tctl JSON
  if ! HOST_CA="$(kubectl -n "$TELEPORT_NS" exec "$AUTH_POD" -- tctl auth export --type=tls-host 2>/dev/null)"; then
    HOST_CA="$(kubectl -n "$TELEPORT_NS" exec "$AUTH_POD" -- tctl get cert_authorities --format=json \
      | python3 -c 'import sys,json,base64
c=json.load(sys.stdin)
for x in (c if isinstance(c,list) else [c]):
  if x.get("spec",{}).get("type")=="host":
    for k in x["spec"].get("active_keys",{}).get("tls",[]):
      print(base64.b64decode(k["cert"]).decode())
')"
  fi
fi
[[ -n "$HOST_CA" ]] || die "failed to obtain Host CA"
printf '%s\n' "$HOST_CA" > "$WORKDIR/host-ca.pem"
grep -q "BEGIN CERTIFICATE" "$WORKDIR/host-ca.pem" || die "Host CA does not look like PEM"

echo "==> Render tag values with Host CA"
python3 - "$ROOT/values/tag-values.yaml" "$WORKDIR/host-ca.pem" "$WORKDIR/tag-values.yaml" <<'PY'
import sys
from pathlib import Path
src, ca_path, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
text = src.read_text()
ca = ca_path.read_text().strip()
# Indent PEM body for YAML block under "  - |"
indented = "\n".join(("    " + line) if line else "" for line in ca.splitlines())
block = "clusterHostCAs:\n  - |\n" + indented + "\n"
import re
text2, n = re.subn(
    r"clusterHostCAs:\n  - \|\n(?:    .*\n)+",
    block,
    text,
    count=1,
)
if n != 1:
    raise SystemExit("failed to inject clusterHostCAs into tag-values.yaml")
out.write_text(text2)
print(f"wrote {out}")
PY

echo "==> Helm install/upgrade Access Graph (local chart, no repo)"
if helm -n "$TAG_NS" status "$TAG_RELEASE" >/dev/null 2>&1; then
  helm upgrade "$TAG_RELEASE" "$CHART_TAG" -n "$TAG_NS" -f "$WORKDIR/tag-values.yaml"
else
  helm install "$TAG_RELEASE" "$CHART_TAG" -n "$TAG_NS" -f "$WORKDIR/tag-values.yaml"
fi
kubectl -n "$TAG_NS" rollout status deployment/teleport-access-graph --timeout=300s

echo "==> Mount Access Graph CA into Teleport Auth"
kubectl -n "$TELEPORT_NS" create configmap teleport-access-graph-ca \
  --from-file=ca.pem="$CERT_DIR/ca.crt" \
  --dry-run=client -o yaml | kubectl apply -f -

if [[ "$SKIP_TELEPORT_UPGRADE" == "true" ]]; then
  echo "SKIP_TELEPORT_UPGRADE=true — apply access_graph config to Auth manually."
  echo "See values/teleport-cluster-with-access-graph.yaml"
  exit 0
fi

[[ -f "$CHART_TP" ]] || die "missing $CHART_TP"

# Prefer existing release values if present; otherwise use repo base + AG overlay.
echo "==> Enabling access_graph on teleport-cluster release=$TELEPORT_RELEASE ns=$TELEPORT_NS"
if helm -n "$TELEPORT_NS" status "$TELEPORT_RELEASE" >/dev/null 2>&1; then
  helm -n "$TELEPORT_NS" get values "$TELEPORT_RELEASE" -o yaml > "$WORKDIR/current-values.yaml"
  helm upgrade "$TELEPORT_RELEASE" "$CHART_TP" -n "$TELEPORT_NS" \
    -f "$WORKDIR/current-values.yaml" \
    -f "$ROOT/values/teleport-cluster-with-access-graph.yaml"
else
  die "teleport-cluster release '$TELEPORT_RELEASE' not found in ns '$TELEPORT_NS'"
fi

kubectl -n "$TELEPORT_NS" rollout status deployment/teleport-auth --timeout=300s || \
  kubectl -n "$TELEPORT_NS" rollout status statefulset/teleport-auth --timeout=300s || true
kubectl -n "$TELEPORT_NS" rollout restart deployment/teleport-proxy
kubectl -n "$TELEPORT_NS" rollout status deployment/teleport-proxy --timeout=300s

echo "==> Optional: create access-graph-reader role"
AUTH_POD="$(kubectl -n "$TELEPORT_NS" get pod -l app.kubernetes.io/component=auth -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$TELEPORT_NS" exec -i "$AUTH_POD" -- tctl create -f - < "$ROOT/manifests/access-graph-reader-role.yaml" || true

echo
echo "Done."
echo "  Access Graph: svc/${TAG_RELEASE} in ns/${TAG_NS} :443"
echo "  UI: Identity Security → Graph Explorer (needs Identity Security license + role)"
echo "  Assign role: tctl users update <user> --set-roles=<existing>,access-graph-reader"
