# Teleport 기능 검증 상세 (1차 · CE 기반 실측)

> 본 문서는 [KAC POC 종합 보고서](../KAC-POC-종합보고서.md)의 **Teleport 후보 근거**다.
> Teleport의 접근/감사 기능을, 현 시점 검증 가능한 **Community Edition으로 1차 실측**했다. 심화 통제는 **Enterprise 라이선스 확보 후 실측 예정**이며, 해당 항목은 `Enterprise 검증예정`으로 표기한다.

| 항목 | 내용 |
|---|---|
| 목적 | Teleport의 KAC 접근제어 기능을 실물로 검증하고, 종합 보고서의 근거를 확보 |
| 검증 수단 | Teleport Community Edition 18.10.3 (현재 확보 가능한 수단) |
| 검증 환경 | 멀티노드 Kubernetes(v1.25.16)에 실제 설치 후 실측 |
| 작성자 | [작성자명] |
| 작성일 | 2026-08-02 |
| 검증 상태 | `실측`=직접 확인 · `Enterprise 검증예정`=라이선스 후 실측 · `문서확인` |

---

## 1. 요약

**Teleport의 접근제어·감사 핵심 기능(RBAC 최소권한 · MFA · 세션 레코딩 · 구조화 감사로그 · 신원 Lock)이 실제로 동작함을 실측으로 확인했다.** 감사 심화 통제(기업 IdP SSO·승인 워크플로·주기적 접근검토·Moderated Session·HA 등)는 Enterprise 기능으로, 라이선스 확보 후 동일 시나리오로 검증할 예정이다.

- 현재 검증 수단은 CE이며, **실서비스 도입 기준은 Teleport Enterprise**다. CE는 "제품 기능이 실제로 동작하는지"를 확인하는 용도로 사용했다.
- 아래 표의 `Enterprise 검증예정` 항목만 라이선스 확보 후 채우면 Teleport 검증이 완성된다.

### 실측 확인 요약

| 확인한 기능 | 결과 |
|---|---|
| RBAC 최소권한 | 읽기전용 역할로 `dev` 조회 허용, `prod` 조회·`dev` 삭제 거부, `get ns`는 `dev`만 노출 |
| MFA(2FA) | `type: local` + `second_factors`(webauthn/otp) 강제 |
| 구조화 감사로그 | 모든 kube 호출을 신원·verb·리소스·네임스페이스로 기록(거부 포함) |
| 세션 레코딩 | `kubectl exec` 실행 명령·컨테이너·노드까지 세션 이벤트로 기록 |
| 신원 Lock | 사용자 Lock 후 접근 즉시 `access denied` |
| 단기 인증서·유휴 타임아웃 | 세션 TTL, `client_idle_timeout: 5m` 적용 |

---

## 2. 검증 환경 (재현 가능)

| 항목 | 값 |
|---|---|
| 클러스터 | 멀티노드 Kubernetes(control-plane + worker ×3), v1.25.16 |
| Teleport | teleport-cluster 18.10.3, self-signed TLS, multiplex proxy |
| 등록 대상 | 검증 클러스터를 kube 리소스로 등록(health check 통과) |
| 검증 계정 | `viewer1`(읽기전용), `admin1`(편집) — 개별 식별 계정 |

> 설치·구성·명령·이벤트 원문: 별첨 [`evidence/`](./evidence/)

---

## 3. 영역별 검증 결과

> `실측`은 본 POC에서 직접 확인, `Enterprise 검증예정`은 라이선스 확보 후 실측할 항목.

### 3.1 인증
| 통제 항목 | 판정 | 검증 상태 | 근거 / 비고 |
|---|---|---|---|
| 개인 식별 계정(공용계정 배제) | 충족 | 실측 | 모든 이벤트가 `login`/`user`에 귀속 |
| MFA(2FA, OTP/WebAuthn) 강제 | 충족 | 실측 | 인증정책에 `type: local` + `second_factors` 강제 |
| 기업 IdP SSO(SAML/OIDC) | 충족(예정) | Enterprise 검증예정 | Enterprise에서 SAML/OIDC 커넥터로 사내 IdP 연동. 라이선스 후 실측 |

### 3.2 인가 및 권한관리
| 통제 항목 | 판정 | 검증 상태 | 근거 / 비고 |
|---|---|---|---|
| RBAC 최소권한(namespace·verb) | 충족 | 실측 | `dev` 조회 허용, `prod` 조회·`dev` 삭제 거부 |
| 접근 가능 리소스만 노출 | 충족 | 실측 | `get ns`가 접근 가능한 `dev`만 반환 |
| JIT 임시권한 + 승인 워크플로 | 충족(예정) | 일부 실측 + Enterprise 검증예정 | CE는 CLI 요청+관리자 수동 승인까지 확인. 승인 워크플로·ChatOps는 Enterprise |
| 주기적 접근검토(Access Reviews) | 충족(예정) | Enterprise 검증예정 | Enterprise Access Lists로 제공. 라이선스 후 실측 |

### 3.3 접속·세션관리 및 UX
| 통제 항목 | 판정 | 검증 상태 | 근거 / 비고 |
|---|---|---|---|
| 짧은 수명 인증서 / 세션 TTL | 충족 | 실측 | 역할 `max_session_ttl`, 단기 인증서 발급 |
| 유휴 세션 타임아웃 | 충족 | 실측 | `client_idle_timeout: 5m` |
| 표준 도구 연동(kubectl/lens/k9s) | 충족 | 실측(kubectl) | 프록시 경유 kubeconfig 정상. lens/k9s는 동일 kubeconfig 사용(미실측) |
| 세션 참관·강제종료(Moderated) | 충족(예정) | Enterprise 검증예정 | — |
| IP 기반 접근 제한 | 충족(예정) | Enterprise 검증예정 | — |

### 3.4 감사 및 내부통제
| 통제 항목 | 판정 | 검증 상태 | 근거 / 비고 |
|---|---|---|---|
| 구조화 감사로그(who·what·verb·resource) | 충족 | 실측 | `kube.request` 이벤트에 신원·경로·리소스·네임스페이스 기록(거부 포함) |
| 명령/세션 레코딩(kube exec) | 충족 | 실측 | `exec`·`session.start/end`에 실행 명령·컨테이너·노드 기록 |
| 세션/신원 Lock(즉시 차단) | 충족 | 실측 | Lock 후 접근 즉시 `access denied` |
| SIEM 내보내기(Fluentd/Event Handler) | 충족 | 문서확인 | 지원(Elastic/Splunk/Fluentd). 실 파이프라인은 미구성 |
| 자동 이상탐지/Access Monitoring | 충족(예정) | Enterprise 검증예정 | — |

### 3.5 운영 및 유지보수
| 통제 항목 | 판정 | 검증 상태 | 근거 / 비고 |
|---|---|---|---|
| 셀프호스트 배포(Helm) | 충족 | 실측 | Helm 설치, 클러스터 자동 등록·헬스체크 통과 |
| 고가용성(HA)/다중지역 | 충족(예정) | Enterprise 검증예정 | Enterprise/blueprint 필요 |
| 백업·업그레이드·인증서 운영 | 부분 충족 | 문서확인 | 가능하나 셀프호스트 운영공수 |

### 3.6 전환 및 실제 사용
| 통제 항목 | 판정 | 검증 상태 | 근거 / 비고 |
|---|---|---|---|
| 멀티 클러스터 등록 | 부분 충족 | 실측 + 미확인 | 단일 클러스터 등록 실측, 다수는 에이전트 추가(규모 미검증) |
| 기존 kubeconfig 접근 대체 | 충족 | 실측 | 프록시 경유 kubeconfig가 직접 접근 대체 |
| Hela 병행운영·컷오버·롤백 | 미확인 | — | 전환계획 별도 |

---

## 4. 남은 검증 (Enterprise 라이선스 확보 후)

아래 항목만 Enterprise로 실측하면 Teleport 검증이 완성된다.

- 기업 IdP SSO (SAML/OIDC) 연동 및 그룹→역할 매핑
- Access Requests 승인 워크플로 (승인자 역할·다중승인·ChatOps)
- Access Lists 기반 주기적 접근검토
- Moderated Session (세션 참관·강제종료)
- 자동 이상탐지(Access Monitoring), HA 구성

---

## 부록. 근거(별첨)
[`evidence/`](./evidence/) — 설치 values, 적용 리소스(역할·사용자·인증정책·네트워킹), RBAC 검증 transcript, 감사 이벤트 원문, 발급 kubeconfig, 재현 절차.
