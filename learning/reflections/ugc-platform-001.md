---
sprint_id: ugc-platform-001
domain: ugc-platform
completed_at: '2026-04-22T17:30:00+09:00'
outcome: partial
related_patterns:
- correctness-004
- completeness-003
- completeness-005
- completeness-006
- completeness-007
schema_version: 1
---
# Reflection: ugc-platform-001

> Date: 2026-04-22
> Sprint: ugc-platform-001 (UGC Platform Phase 1)
> Domain: 프로필 & 네비게이션

## What worked

- **Discriminated union for SwipeFeed params**: Legacy `{targetId, type, entryPoint}` + new `{source, initialContentId}` 를 union 으로 공존 → legacy callsite 2곳 (`filter-list-item`, `trending-filter-section-item`) touch 없이 profile variant 추가. Type-level backward compat + runtime narrowing (`"source" in params`). 이 패턴은 route param 확장 시 재사용 가능.
- **Frozen Snapshot + 3-round Contract review**: Group 003 contract Round 1 에서 Critical 1 + Major 3 사전 발견 → Round 2 에서 7 patches 적용 후 Evaluator APPROVE. FE 가 코드 쓰기 전에 계약이 "정답 포함" 상태로 정렬됨 — 구현 후 재작업 최소화.
- **Prototype spec 우선 해석**: OtherUserProfile 탭바 유무 결정에서 계약 Ground Rule 2 "단일 탭 노출" vs prototype spec "NO tab-bar, grid directly" 충돌 → prototype SSOT 채택 + Evaluator Non-issue 판정. Canonical 해석 분쟁 시 "가장 가까운 디자인 아티팩트" 우선 원칙 유효.
- **Inline fix for 1-char regression**: be-003/004 cursor `$lt → $lte` 는 Sprint Lead 가 1-char 수정으로 inline 처리 (commit `000fc8fd`) — Generator-Evaluator 분리 원칙을 보존하면서 Round 3 개입 회피.

## What failed (with root cause)

- **Group 001 E2E harness 가 1회 fix loop 에서 2-step 수정 필요**: 첫 fix (lint + schema test) 만으로는 E2E 가 실제로 돈 적 없음 — testMatch 미매치로 0 실행이었음. Round 2 에서 nx target + moduleNameMapper 추가로 해소. Root cause: **spec_ambiguity** (contract §공통빌드품질 "E2E" 요구가 "실행됨" 이 아닌 "파일 존재" 로 해석 가능). → completeness-005 KB 등재, rubric C11 승격.
- **Group 002 Route type 변경 시 legacy callsite 누락**: `Home: { tag?: string }` → `NavigatorScreenParams<RootTabParamList>` 전환 후 `generating-failed.screen.tsx:45` callsite 가 TS2353 regression. `@wrtn/*` cascade 에 섞여 FE Engineer 자가 보고에서 "0 new errors" 로 착시. Root cause: **spec_ambiguity** — completeness-003 clause 가 "신규 param" 만 다루고 "타입 변경" 커버 부족. → completeness-003 frequency +1, rubric C7 "(v3 확장)" 으로 보강.
- **Group 003 Discriminated union 도입 후 두 variant queryFn 무조건 fire**: Hooks-rule 준수하려다 `enabled` gate 미적용 → legacy variant 에서 `/me/contents` + profile variant 에서 empty targetId `/meme/feeds/swipe` 양쪽 불필요한 호출. Major 1 + Minor 1 동일 class. Root cause: **spec_ambiguity** — Contract Done Criterion 이 variant 별 fire gate 를 명시하지 않음. → completeness-006 KB 등재, rubric C12 승격.
- **app-008 `currentTab` prop threading 누락**: Contract 가 `visibility: currentTab` 을 요구했으나 `ProfileContentGrid` / `ProfileContentItem` 시그니처에 `tab` prop 부재 — Round 1 review 에서 발견. Root cause: **spec_ambiguity** — Planner 단계에서 parent context 의존 payload 의 prop flow 를 수동 trace 하지 않음. → completeness-007 KB 등재, rubric C13 승격.

## Lesson (next-sprint actionable)

- **Phase 2 Spec 에서 api-contract + e2e-flow-plan 작성 후**, Planner 는 "navigate payload 가 parent state 를 참조하는가" 를 각 Ground Rule 별로 체크. 의존 존재 시 Done Criterion 에 prop threading 경로를 명시.
- **Phase 4 Contract drafting 에서 Discriminated union / parent-dependent query 도입** 시, Done Criterion 에 "variant 별 queryFn 은 `enabled` option 으로 gate" 문구 필수 (rubric C12 반영).
- **Evaluator Active Evaluation 에서 FE typecheck 결과**를 `grep -v '@wrtn/'` 로 clean 측정 — pre-existing cascade 와 신규 regression 구분 (rubric C7 v3 확장).
- **E2E / Jest 테스트 harness 검증**을 Evaluator V-method 에 포함 (`nx test --listTests | grep e2e-spec` → 신규 파일 포함 여부, rubric C11).
- **Repository cursor 쿼리**에 `$lt` 사용 시 즉시 red flag — Contract V-method grep 에 `rg '_id:\s*\{\s*\$lt\s*:' repository/` → 0 hit 의무 (rubric C10).
- **Deferred AC (native sheet / 404 seed)** 는 Phase 5 PR 제출 전 수동 QA 체크리스트로 정리 — ugc-platform-002 진입 시 AC-2.3 공유 + AC-7.4 404 수동 검증 필수.

## Pointers

- Patterns: `learning/patterns/correctness-004.yaml`, `completeness-003.yaml` (freq 2), `completeness-005.yaml`, `completeness-006.yaml`, `completeness-007.yaml`
- Rubric: `learning/rubrics/v3.md` (v2 superseded)
- Gap analysis: `sprint-orchestrator/sprints/ugc-platform-001/retrospective/gap-analysis.yaml`
- Pattern digest: `sprint-orchestrator/sprints/ugc-platform-001/retrospective/pattern-digest.yaml`
- REPORT: `sprint-orchestrator/sprints/ugc-platform-001/REPORT.md`

> 직전 lesson 반영도: partially — free-tab-diversification 의 "Cross-path Cleanup/Rollback 일원화" (C5) 는 본 스프린트 직접 적용되지 않았으나 "Route Params 완전성" (C7) 는 이번 완료능경 regression 으로 재확인 → C7 강화 (v3). "Deep link passthrough 방어" (C8) 는 app-006 의 `profile/:userId` 경로에서 `tabNavigation.replace('OtherUserProfile')` branching 으로 반영.
