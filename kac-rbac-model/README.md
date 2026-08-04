# KAC RBAC model (team × tier) — local Teleport POC

로컬 Teleport CE + docker-desktop 클러스터에 적용하는 **팀 × 등급** 권한 모델 정의입니다.

## 구조

```
kac-rbac-model/
  k8s/                 # Namespace, ClusterRole(템플릿), RoleBinding(팀 그룹)
  teleport/            # Teleport Role (팀×등급) + 테스트 User
  apply-k8s.sh
  kubeconfigs/         # tctl auth sign 산출물 (gitignore, 재생성)
```

| Tier | K8s ClusterRole | Teleport verbs (대략) | Group 예 |
|------|-----------------|----------------------|----------|
| viewer | `kac-ns-viewer` | get, list, watch | `team-payments-viewer` |
| troubleshooter | `kac-ns-troubleshooter` | get, list, watch + `exec`/`portforward`† | `team-payments-troubleshooter` |
| admin | `kac-ns-admin` | get, list, watch, create, update, patch | `team-payments-admin` |
| cluster-admin | `kac-cluster-admin` | (별도) | `kac-cluster-admin` |

† Teleport Role v7은 `kind: pod`(단수) + verbs `exec`/`portforward`. K8s는 `pods/exec`에 `get`+`create`(1.30+ websocket). pods 본문 create는 양쪽 모두 없음.

## 적용

```bash
# 1) K8s (클러스터 관리자 컨텍스트)
./apply-k8s.sh   # KUBE_CONTEXT=docker-desktop

# 2) Teleport roles / users
for f in teleport/*-ns-*.yaml; do tctl create -f "$f" --insecure --force; done
tctl create -f teleport/users.yaml --insecure --force

# 3) 테스트 kubeconfig (auth 파드에서 서명; distroless라 kubectl cp 불가 → --tar)
AUTH=$(kubectl -n teleport get pod -l app.kubernetes.io/component=auth -o jsonpath='{.items[0].metadata.name}')
mkdir -p kubeconfigs
for u in alice-payments-viewer bob-payments-troubleshooter carol-payments-admin dave-pe-admin eve-both-viewer; do
  kubectl -n teleport exec "$AUTH" -- /usr/local/bin/tctl auth sign \
    --user="$u" --format=kubernetes \
    --kube-cluster-name=p-sandbox-ol-poc-1 \
    --proxy=https://localhost:8443 --ttl=2h --overwrite --tar -o "$u.kubeconfig" 2>/dev/null \
    | tar -xf - -C kubeconfigs
done
```

## 테스트 계정

| User | Roles |
|------|--------|
| `alice-payments-viewer` | payments-ns-viewer |
| `bob-payments-troubleshooter` | payments-ns-troubleshooter |
| `carol-payments-admin` | payments-ns-admin |
| `dave-pe-admin` | pe-ns-admin |
| `eve-both-viewer` | payments-ns-viewer, pe-ns-viewer |

비밀번호 미설정 — POC는 `tctl auth sign` kubeconfig로 검증합니다.
