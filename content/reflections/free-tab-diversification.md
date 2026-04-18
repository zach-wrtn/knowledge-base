---
sprint_id: free-tab-diversification
domain: free-tab
completed_at: '2026-04-01T00:00:00+09:00'
outcome: pass
schema_version: 1
---
# Reflection: free-tab-diversification

> Date: 2026-04-14
> Sprint: free-tab-diversification
> Domain: ZZEM 무료탭 UX

## What worked

- **Frozen Snapshot Protocol**: 재사용 훅(`useTabScrollRestore`, `useFreeGenCTA`) 설계를 app-003 단계에서 의도적으로 분리해 app-004가 re-implement 없이 consume. Group 004가 0 fix loops로 통과한 핵심 요인.
- **RosterContext 분리 패턴**: pricing source와 display source를 `todayActiveSlots` + `displaySlots`로 명시 분리 — 폴백 응답에서도 UI/생성 불일치 없이 서버 eligibility와 맞춤. 향후 폴백 기반 응답에서 재활용 가능.
- **Cross-repo cleanup 일원화**: `GenMemeDomainService.rollbackFreeQuotaByContentId` private helper 패턴 — legacy + new workflow 20+ 콜백 사이트가 자동 커버. 이후 새 경로 추가 시 automatic.

## What failed (with root cause)

- **Major: BR-2 legacy rollback 누락** (group-002) — root cause: `dependency`. 신규 `ContentsGenerationAppService.handleError`에만 UserFreeQuota cleanup이 추가되고 legacy `GenMemeDomainService.setContentError`에 반영 안 됨. 해소: 공통 helper 도입.
- **Major: 어제 폴백 pricing 과다 노출** (group-002) — root cause: `spec_ambiguity`. Contract가 "오늘 ACTIVE + freeUsedToday==false → 0"만 명시, 폴백 응답 pricing 규칙 암묵적. 해소: display/pricing source 분리.
- **Major: freeUsedToday passthrough 누락** (group-003) — root cause: `spec_ambiguity`. `route.types.ts`에 param 정의만 하고 실 호출부 전달 의무가 Contract에 명시되지 않음. 해소: passthrough + deps 추가.

## Lesson (next-sprint actionable)

- **Contract 작성 시 복수 경로 cleanup 의무 명시**: "새 cleanup 로직은 모든 기존 진입점에 주입"을 Done Criteria 템플릿에 포함 (Rubric v2 C5).
- **폴백 응답 스펙 상세화**: 응답 필드가 pricing에 영향 주면 폴백 시 계산 기준을 Contract에 명시 (Rubric v2 C6).
- **Route params 추가 Contract**: navigation params 추가 시 "모든 호출부 전달 + useCallback deps" 항목 Done Criteria에 포함 (Rubric v2 C7).
- **Deep link 경로 fallback 명시**: navigation params 의존 화면은 deep link 직진입 최소 동작 보장 요건을 Contract에 포함 (Rubric v2 C8).
- **E2E env prerequisites 문서화**: seed/token/VPN 의존 flow는 상단 주석에 조건 명시 + `optional: true` 방어 (Rubric v2 C9).
- **재사용 훅 선행 설계**: 외부 진입점 복수 가능한 경우 app-003급 단계에서 `use*CTA` 훅을 공통 폴더로 추출 — 후속 task(app-004급) fix loop 방지.

## Pointers

- Pattern digest: `sprints/free-tab-diversification/retrospective/pattern-digest.yaml` (6 patterns)
- Gap analysis: `sprints/free-tab-diversification/retrospective/gap-analysis.yaml` (100% fulfillment)
- Deferred items: `sprints/free-tab-diversification/retrospective/deferred-items.yaml` (11 minor improvements)
- Rubric promoted: `knowledge-base/rubrics/v2.md` (C5~C9 신규)
- PRs: backend #734, app #514

> 직전 lesson 반영도: N/A — 본 도메인에서 첫 Reflexion reflection.
