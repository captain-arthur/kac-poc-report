#!/usr/bin/env bash
# Access Graph POC용 서버 인증서 + TLS Secret 생성 (배포는 하지 않음)
# SAN: teleport-access-graph.teleport.svc.cluster.local
set -euo pipefail

NS="${NS:-teleport}"
SECRET_NAME="${SECRET_NAME:-teleport-access-graph-tls}"
OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")" && pwd)/certs}"
SAN="${SAN:-teleport-access-graph.teleport.svc.cluster.local}"

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

openssl genrsa -out ca.key 4096
openssl req -x509 -new -key ca.key -sha256 -days 3650 -out ca.crt -subj '/CN=tag-poc-ca'

openssl req -new -newkey rsa:4096 -nodes -keyout cert.key -out cert.csr -subj '/CN=Access Graph'
openssl x509 -req -in cert.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out cert.crt -days 3650 -sha256 \
  -extfile <(printf "extendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:%s" "$SAN")

rm -f cert.csr ca.srl
chmod 600 ca.key cert.key

kubectl -n "$NS" create secret tls "$SECRET_NAME" \
  --cert=cert.crt --key=cert.key \
  --dry-run=client -o yaml | kubectl apply -f -

echo
echo "OK"
echo "  certs:  $OUT_DIR  (ca.crt 는 나중에 Auth ConfigMap 용)"
echo "  secret: $NS/$SECRET_NAME"
echo "  SAN:    $SAN"
ls -la "$OUT_DIR"
