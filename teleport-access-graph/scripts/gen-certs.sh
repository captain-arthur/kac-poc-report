#!/usr/bin/env bash
# Generate a self-signed CA + server cert for Access Graph (POC only).
# SAN: teleport-access-graph.teleport-access-graph.svc.cluster.local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="${CERT_DIR:-$ROOT/certs}"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

# Unencrypted CA key for non-interactive POC use.
openssl genrsa -out ca.key 4096
openssl req -x509 -new -key ca.key -sha256 -days 3652 -out ca.crt -subj '/CN=teleport-access-graph-poc-ca'
openssl req -new -out cert.csr -newkey rsa:4096 -nodes -keyout cert.key -subj '/CN=Access Graph'
openssl x509 -req -in cert.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out cert.crt -days 3652 -sha256 \
  -extfile <(printf 'extendedKeyUsage = serverAuth, clientAuth\nsubjectAltName = DNS:teleport-access-graph.teleport-access-graph.svc.cluster.local')

rm -f cert.csr ca.srl
chmod 600 ca.key cert.key
echo "Wrote POC certs under $CERT_DIR"
ls -la "$CERT_DIR"
