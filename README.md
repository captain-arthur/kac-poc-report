관련 디렉터리:

- [`kac-rbac-model/`](./kac-rbac-model/) — Teleport Role ↔ K8s Group RBAC 예시
- [`teleport-access-graph/`](./teleport-access-graph/) — Access Graph POC (같은 `teleport` ns, 수동 Helm 절차)
- [`reports/`](./reports/) — POC 보고서·evidence

---

`payments` / `pe` 두 네임스페이스만 있다고 가정한 **전체 예시**입니다.

---

## 0. 미리 깔아 두는 것

### ClusterRole (클러스터에 1번만)

| 이름 | 의미 |
|---|---|
| `kac-ns-viewer` | 조회 |
| `kac-ns-troubleshooter` | 조회 + 로그/exec 등 |
| `kac-ns-admin` | ns 관리 (delete 제외 등) |
| `kac-cluster-admin` | 클러스터 관리 → **이건 ClusterRoleBinding** (여기 예시에선 ns 이야기에선 생략 가능) |

---

## 1. K8s RoleBinding (ns × 팀-등급)

### payments ns

```yaml
# payments: viewer
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kac-ns-viewer
  namespace: payments
roleRef:
  kind: ClusterRole
  name: kac-ns-viewer
  apiGroup: rbac.authorization.k8s.io
subjects:
  - kind: Group
    name: team-payments-viewer
---
# payments: troubleshooter
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kac-ns-troubleshooter
  namespace: payments
roleRef:
  kind: ClusterRole
  name: kac-ns-troubleshooter
  apiGroup: rbac.authorization.k8s.io
subjects:
  - kind: Group
    name: team-payments-troubleshooter
---
# payments: admin
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kac-ns-admin
  namespace: payments
roleRef:
  kind: ClusterRole
  name: kac-ns-admin
  apiGroup: rbac.authorization.k8s.io
subjects:
  - kind: Group
    name: team-payments-admin
```

### pe ns (같은 패턴, Group 이름만 pe)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kac-ns-viewer
  namespace: pe
roleRef:
  kind: ClusterRole
  name: kac-ns-viewer
  apiGroup: rbac.authorization.k8s.io
subjects:
  - kind: Group
    name: team-pe-viewer
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kac-ns-troubleshooter
  namespace: pe
roleRef:
  kind: ClusterRole
  name: kac-ns-troubleshooter
  apiGroup: rbac.authorization.k8s.io
subjects:
  - kind: Group
    name: team-pe-troubleshooter
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kac-ns-admin
  namespace: pe
roleRef:
  kind: ClusterRole
  name: kac-ns-admin
  apiGroup: rbac.authorization.k8s.io
subjects:
  - kind: Group
    name: team-pe-admin
```

---

## 2. Teleport Role (Group과 1:1)

```yaml
kind: role
metadata:
  name: payments-ns-viewer
spec:
  allow:
    kubernetes_groups: ["team-payments-viewer"]
    kubernetes_labels: {"*": "*"}
    kubernetes_resources:
      - kind: "*"
        namespace: payments
        name: "*"
        verbs: ["get", "list", "watch"]
---
kind: role
metadata:
  name: payments-ns-troubleshooter
spec:
  allow:
    kubernetes_groups: ["team-payments-troubleshooter"]
    kubernetes_labels: {"*": "*"}
    kubernetes_resources:
      - kind: "*"
        namespace: payments
        name: "*"
        verbs: ["get", "list", "watch", "create"]  # K8s troubleshooter와 맞춤
---
kind: role
metadata:
  name: payments-ns-admin
spec:
  allow:
    kubernetes_groups: ["team-payments-admin"]
    kubernetes_labels: {"*": "*"}
    kubernetes_resources:
      - kind: "*"
        namespace: payments
        name: "*"
        verbs: ["get", "list", "watch", "create", "update", "patch"]
---
# pe도 동일 패턴
kind: role
metadata:
  name: pe-ns-viewer
spec:
  allow:
    kubernetes_groups: ["team-pe-viewer"]
    kubernetes_labels: {"*": "*"}
    kubernetes_resources:
      - kind: "*"
        namespace: pe
        name: "*"
        verbs: ["get", "list", "watch"]
---
kind: role
metadata:
  name: pe-ns-admin
spec:
  allow:
    kubernetes_groups: ["team-pe-admin"]
    kubernetes_labels: {"*": "*"}
    kubernetes_resources:
      - kind: "*"
        namespace: pe
        name: "*"
        verbs: ["get", "list", "watch", "create", "update", "patch"]
```

---

## 3. 사용자에게 부여하면 어떻게 되나

| 사용자 | Teleport Role 부여 | 실제 권한 |
|---|---|---|
| Alice | `payments-ns-viewer` | **payments** 조회만. pe는 불가 |
| Bob | `payments-ns-troubleshooter` | **payments** 조회+디버깅. pe 불가 |
| Carol | `payments-ns-admin` | **payments** 관리. pe 불가 |
| Dave | `pe-ns-admin` | **pe** 관리. payments 불가 |
| Eve | `payments-ns-viewer` + `pe-ns-viewer` | 두 ns **조회만** |

예:

```bash
tctl users update alice --set-roles=payments-ns-viewer --insecure
tctl users update dave --set-roles=pe-ns-admin --insecure
tctl users update eve --set-roles=payments-ns-viewer,pe-ns-viewer --insecure
```

---

## 4. 흐름 한 장

```text
Alice
  → Teleport Role: payments-ns-viewer
      → kubernetes_groups: team-payments-viewer
          → RoleBinding in namespace=payments
              → ClusterRole: kac-ns-viewer
          → pe ns에는 이 Group Binding 없음 → pe 권한 없음

Dave
  → Teleport Role: pe-ns-admin
      → group: team-pe-admin
          → RoleBinding in namespace=pe
              → ClusterRole: kac-ns-admin
```

---

## 5. 뭐가 몇 개인가 (이 예시)

| 종류 | 개수 |
|---|---|
| ClusterRole (ns 등급) | **3** (viewer/troubleshooter/admin) |
| RoleBinding | ns 2 × 등급 3 = **6** |
| Teleport Role | 팀(payments/pe) × 쓰는 등급 (예: 5~6개) |
| 사용자 작업 | Role **부여만** |

**한 줄:**  
payments/pe는 **각자 팀 Group + 그 ns RoleBinding**이고,  
사용자는 `payments-ns-*` / `pe-ns-*` Teleport Role을 받으면  
해당 ns·해당 등급만 갖게 됩니다.