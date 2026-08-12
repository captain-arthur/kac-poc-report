# Teleport Access Graph (Identity Security) — offline package

내부망에서 Helm repo / public ECR에 접근하지 못할 때를 가정한 **오프라인 설치 패키지**입니다.

> **필수:** Teleport **Enterprise** + 라이선스에 **Identity Security** 포함.  
> Community Edition에는 Access Graph가 없습니다. UI의 Identity Security 탭만으로는 동작하지 않고, 본 서비스가 Auth에 연결되어야 합니다.

공식 문서: [Self-hosted Access Graph (Helm)](https://goteleport.com/docs/identity-security/access-graph/self-hosted-helm/)

## 포함 내용

| 경로 | 설명 |
|---|---|
| `charts/teleport-access-graph-1.30.2.tgz` | Access Graph Helm 차트 (로컬 설치용) |
| `charts/teleport-cluster-18.10.3.tgz` | Teleport 클러스터 차트 (Auth에 `access_graph` 켤 때 upgrade용) |
| `values/` | TAG / teleport-cluster values |
| `manifests/postgres-poc.yaml` | POC용 PostgreSQL (비운영) |
| `manifests/access-graph-reader-role.yaml` | Graph Explorer용 Teleport role |
| `scripts/fetch-artifacts.sh` | **외부망**에서 이미지 tar 받기 |
| `scripts/gen-certs.sh` | Access Graph TLS(SAN) 생성 |
| `scripts/install-offline.sh` | **내부망** 설치 (port-forward 없음) |
| `versions.env` | 핀된 버전 |

이미지 tar는 용량 때문에 git에 넣지 않습니다. 기본 설치는 Docker Hub 미러(`qlqjs90/*`)를 pull합니다.

## 버전 / 이미지 미러

| 용도 | 미러 (사용) | upstream |
|---|---|---|
| Access Graph | `qlqjs90/access-graph:1.30.2` | `public.ecr.aws/gravitational/access-graph:1.30.2` |
| Teleport | `qlqjs90/teleport-distroless:18.10.3` | `public.ecr.aws/gravitational/teleport-distroless:18.10.3` |
| POC Postgres | `qlqjs90/postgres:16-alpine` | `postgres:16-alpine` |

- Teleport cluster chart: **18.10.3**
- Access Graph chart: **1.30.2**

## 빠른 절차

### A. 외부망 — 미러 갱신 (필요할 때만)

```bash
cd teleport-access-graph
./scripts/fetch-artifacts.sh
# linux/amd64 pull → qlqjs90/* push
# tar도 필요하면: SAVE_TAR=true ./scripts/fetch-artifacts.sh
```

### B. 내부망 — 이미지

Docker Hub(`qlqjs90`)에 접근 가능하면 별도 load 없이 설치 스크립트가 pull합니다.

완전 폐쇄망이면:

```bash
docker pull qlqjs90/access-graph:1.30.2
docker pull qlqjs90/postgres:16-alpine
docker pull qlqjs90/teleport-distroless:18.10.3
docker save ... # 또는 fetch-artifacts.sh SAVE_TAR=true 결과물 load
```

### C. 내부망 — 설치

전제: Teleport Enterprise가 이미 클러스터에 떠 있고 (`ns/teleport`, release `teleport`), Identity Security 라이선스가 적용되어 있음.

```bash
cd teleport-access-graph
chmod +x scripts/*.sh
./scripts/install-offline.sh
```

스크립트가 하는 일:

1. POC Postgres 설치 (기본)
2. Access Graph용 TLS 발급 + Secret
3. Teleport Host CA 추출 → `clusterHostCAs` 주입
4. **로컬 차트**로 `teleport-access-graph` install/upgrade (`helm repo` 불필요)
5. Auth에 CA ConfigMap 마운트 + `access_graph.enabled`
6. Proxy restart + `access-graph-reader` role 생성

환경 변수 예시:

```bash
TELEPORT_NS=teleport \
TELEPORT_RELEASE=teleport \
INSTALL_POSTGRES=true \
./scripts/install-offline.sh
```

기존 운영 Postgres를 쓰면:

```bash
INSTALL_POSTGRES=false \
POSTGRES_URI='postgres://user:pass@host:5432/access_graph?sslmode=require' \
./scripts/install-offline.sh
```

Host CA를 파일로 넘길 때:

```bash
HOST_CA_FILE=./host-ca.pem ./scripts/install-offline.sh
```

### D. UI 확인

1. 사용자에 `access-graph-reader`(또는 `editor`) 부여  
2. Web UI → **Identity Security** → **Graph Explorer**

## 수동 설치 (스크립트 없이)

```bash
# 1) Postgres + secrets + certs (gen-certs.sh)
kubectl apply -f manifests/postgres-poc.yaml
./scripts/gen-certs.sh
kubectl -n teleport-access-graph create secret tls teleport-access-graph-tls \
  --cert=certs/cert.crt --key=certs/cert.key
kubectl -n teleport-access-graph create secret generic teleport-access-graph-postgres \
  --from-literal uri='postgres://access_graph:access_graph@teleport-access-graph-postgres:5432/access_graph?sslmode=disable'

# 2) values/tag-values.yaml 의 clusterHostCAs 를 Host CA PEM으로 교체

# 3) Access Graph
helm install teleport-access-graph ./charts/teleport-access-graph-1.30.2.tgz \
  -n teleport-access-graph -f values/tag-values.yaml

# 4) Auth 연동
kubectl -n teleport create configmap teleport-access-graph-ca --from-file=ca.pem=certs/ca.crt
helm upgrade teleport ./charts/teleport-cluster-18.10.3.tgz -n teleport \
  -f <기존 values> -f values/teleport-cluster-with-access-graph.yaml
kubectl -n teleport rollout restart deployment/teleport-proxy
```

## 주의

- Postgres POC는 emptyDir·고정 패스워드 — **데모 전용**
- TLS 스크립트도 POC용 self-signed
- Identity Security 미포함 라이선스면 Auth 설정 후에도 탭이 동작하지 않음
- 이 디렉터리의 스크립트는 **port-forward를 실행하지 않음**
