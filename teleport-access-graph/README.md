# Access Graph POC (수동 절차)

별도 네임스페이스 없음. 전부 **`teleport` ns** (기존 Auth/Proxy 옆).

필요한 파일:
- `charts/tag-postgres/`
- `charts/teleport-access-graph/`
- `postgres-ol-values.yaml`
- `ol-values.yaml`
- `auth-ol-values.yaml`

이미지: `qlqjs90/postgres:16-alpine`, `qlqjs90/access-graph:1.30.2`

---

## Step 1 — Postgres

```bash
helm install tag-postgres ./charts/tag-postgres \
  -n teleport -f postgres-ol-values.yaml
```

---

## Step 2 — Access Graph용 서버 인증서 (Secret)

Host CA와 **다른 것**. Access Graph 서비스 자기 인증서입니다.

```bash
chmod +x ./gen-certs.sh
./gen-certs.sh
# → ./certs/ 에 ca.crt·cert.crt·cert.key 생성
# → ns/teleport secret/teleport-access-graph-tls 생성
```

`certs/ca.crt`는 Step 4에서 씀. 지우지 말 것.

---

## Step 3 — Host CA를 `ol-values.yaml`에 넣기

Teleport이 **이미 갖고 있는** 클러스터 Host CA입니다. (Step 2 인증서 아님)

```bash
kubectl -n teleport exec deploy/teleport-auth -- tctl auth export --type=tls-host
```

출력된 `-----BEGIN CERTIFICATE----- ...` 전체를  
`ol-values.yaml`의 `REPLACE_WITH_TELEPORT_HOST_CA` 자리에 붙여넣기.

그다음:

```bash
helm install teleport-access-graph ./charts/teleport-access-graph \
  -n teleport -f ol-values.yaml
```

---

## Step 4 — 기존 Auth에 연결

```bash
# Step 2에서 만든 certs/ca.crt
kubectl -n teleport create configmap teleport-access-graph-ca \
  --from-file=ca.pem=./certs/ca.crt

# 기존 teleport release 에 overlay (차트는 설치할 때 쓰던 것 그대로)
helm upgrade teleport <본인-teleport-cluster-차트경로> \
  -n teleport \
  --reuse-values \
  -f auth-ol-values.yaml

kubectl -n teleport rollout restart deployment/teleport-proxy
```

UI: **Identity Security → Graph Explorer**  
(Identity Security 라이선스 + 사용자에게 `access_graph` list/read 권한 필요)
