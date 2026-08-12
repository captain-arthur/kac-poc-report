# Teleport Access Graph — Helm only

차트 2개 + values 2개. **helm install 두 번**이면 됩니다. (teleport-cluster와 별개)

```
charts/tag-postgres-0.1.0.tgz
charts/teleport-access-graph-1.30.2.tgz
postgres-ol-values.yaml
ol-values.yaml
```

이미지: `qlqjs90/postgres:16-alpine`, `qlqjs90/access-graph:1.30.2`

## 1) Postgres

```bash
helm install tag-postgres ./charts/tag-postgres-0.1.0.tgz \
  -n teleport-access-graph --create-namespace \
  -f postgres-ol-values.yaml
```

## 2) Access Graph

TLS Secret + Host CA를 `ol-values.yaml`에 넣은 뒤:

```bash
# TLS (SAN: teleport-access-graph.teleport-access-graph.svc.cluster.local)
kubectl -n teleport-access-graph create secret tls teleport-access-graph-tls \
  --cert=cert.crt --key=cert.key

helm install teleport-access-graph ./charts/teleport-access-graph-1.30.2.tgz \
  -n teleport-access-graph \
  -f ol-values.yaml
```

## 그다음 (Auth 연결)

기존 `teleport-cluster` values에만 추가 후 upgrade:

```yaml
auth:
  teleportConfig:
    access_graph:
      enabled: true
      endpoint: teleport-access-graph.teleport-access-graph.svc.cluster.local:443
      ca: /var/run/access-graph/ca.pem
```

(Access Graph 서버 인증서를 발급한 CA를 Auth에 마운트해야 함)
