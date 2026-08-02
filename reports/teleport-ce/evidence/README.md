# 별첨 — Teleport CE POC 근거(Evidence)

본 디렉터리는 [상위 보고서](../POC-Teleport-CE.md)의 판정 근거다. 모든 결과는 로컬 kind 클러스터 + Teleport CE 18.10.3에서 직접 수행(`실측`)했다.

## 파일 인덱스

| 파일 | 내용 | 관련 판정 |
|---|---|---|
| `values-teleport-cluster.yaml` | Helm 설치 values(standalone, self-signed, multiplex) | 4.5 배포 |
| `teleport-auth-pref.yaml` | 적용 시도한 인증정책(참고) | 4.1 |
| `effective-auth-pref.yaml` | **유효** 인증정책 실측(`tctl get cap`) — MFA 강제 | 4.1 MFA |
| `teleport-net-config.yaml` / `effective-net-config.yaml` | 유휴 타임아웃 5분 적용·실측 | 4.3 |
| `teleport-roles.yaml` | 최소권한 역할(kac-dev-viewer/admin/requester) | 4.2 |
| `teleport-users.yaml` | 테스트 사용자(viewer1/admin1) | 4.1 |
| `k8s-rbac-and-workloads.yaml` | dev/prod 네임스페이스, 그룹 바인딩, 샘플 워크로드 | 4.2 |
| `rbac-test-transcript.txt` | RBAC allow/deny 검증 transcript | 4.2 |
| `audit-events.log` | 구조화 감사 이벤트 원문(kube.request/exec/session.*) | 4.4 |
| `viewer1.kubeconfig` / `admin1.kubeconfig` | 발급 kubeconfig(단기 인증서, 로컬 self-signed 전용) | 4.2/4.3 |

> 주의: kubeconfig에는 단기 클라이언트 인증서/키가 포함된다(로컬 POC·self-signed). 운영 환경 자격증명이 아니며 폐기 대상.

## 핵심 실측 요약

- **RBAC 최소권한(실측):** viewer1은 `dev` 조회만 허용, `prod` 조회·`dev` 삭제는 Teleport 계층에서 거부. `get ns`는 접근 가능한 `dev`만 노출. (`rbac-test-transcript.txt`)
- **감사로그(실측):** 모든 kube API 호출이 `kube.request`로 신원·verb·리소스·네임스페이스와 함께 기록(거부 포함). `kubectl exec`는 `exec`+`session.start/end`로 실행 명령까지 기록. (`audit-events.log`)
- **Lock(실측):** `tctl lock --user=viewer1` 후 viewer1 접근 즉시 `access denied` (CE에서 강제 실효).
- **MFA(실측):** `type: local` + `second_factors`(webauthn/otp) 강제. (`effective-auth-pref.yaml`)
- **유휴 타임아웃(실측):** `client_idle_timeout: 5m`. (`effective-net-config.yaml`)

## 재현 절차 (요약)

```bash
# 1) 설치
helm repo add teleport https://charts.releases.teleport.dev && helm repo update
helm install teleport teleport/teleport-cluster --version 18.10.3 \
  -n teleport --create-namespace -f values-teleport-cluster.yaml

# 2) 리소스 적용 (auth 파드의 tctl 사용; 이미지에 shell/tar 없음 → stdin은 `-f -`)
AUTH=$(kubectl -n teleport get pod -l app.kubernetes.io/component=auth -o jsonpath='{.items[0].metadata.name}')
kubectl apply -f k8s-rbac-and-workloads.yaml
kubectl -n teleport exec -i "$AUTH" -- tctl create --confirm -f - < teleport-net-config.yaml
kubectl -n teleport exec -i "$AUTH" -- tctl create -f - < teleport-roles.yaml
kubectl -n teleport exec -i "$AUTH" -- tctl create -f - < teleport-users.yaml

# 3) 사용자 kubeconfig 발급 후 프록시 경유 접근
kubectl -n teleport exec "$AUTH" -- tctl auth sign --user=viewer1 \
  --format=kubernetes --kube-cluster-name=teleport.local \
  --proxy=https://teleport.local:443 --ttl=8h --out=/tmp/viewer1.kubeconfig
# (distroless 이미지에서 파일 추출은 busybox ephemeral 컨테이너로 수행)
kubectl -n teleport port-forward svc/teleport 18443:443 &
# kubeconfig의 server를 https://127.0.0.1:18443, tls-server-name을
# kube-teleport-proxy-alpn.teleport.local 로 설정 후 kubectl 검증
```
