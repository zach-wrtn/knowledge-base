---
sprint_id: ugc-platform-002
domain: ugc-platform
completed_at: '2026-04-23T00:00:00+09:00'
outcome: pass
related_patterns:
- completeness-008
- completeness-009
- completeness-010
- integration-001
schema_version: 1
---
# Reflection: ugc-platform-002

> Date: 2026-04-23
> Sprint: ugc-platform-002 (UGC Platform Phase 2 — 피드 인터랙션 & 페이백)
> Domain: ugc-platform (follow-up of ugc-platform-001)

## What worked

- **Prior-group lessons 선제 적용으로 fix loop 감소**: Group 001 → 002 → 003 로 fix loop 가 1 → 1 → 0 으로 감소. 특히 Group 003 Contract 에 Group 002 M1 (fallback semantic) / M3 (cross-variant) lesson 을 patches 로 명시 반영하여 **first-try PASS 달성**. Checkpoint 의 "Lessons for Next Group" 섹션을 Contract drafting 시 필수 참조 자원으로 운영하는 프로토콜이 실효성 입증.
- **`isOwnOverride` prop threading 패턴**: Group 002 fix loop R1 에서 mapper fallback (userProfile.id="") 대신 parent source context 를 prop 으로 전달. Group 003 app-006 liked variant 에도 재사용 — semantic-breaking default 회피하는 robust 패턴으로 정착. completeness-007 (prop threading) 의 practical 적용 사례.
- **Frozen Snapshot + Contract Round 2 합의**: 각 그룹 Contract Round 1 ISSUES → Patch 1~8 일괄 적용 → Round 2 APPROVE 사이클이 Sprint Lead / Evaluator 양측 부담 낮추고 구현자 해석 폭 축소. Group 001/002/003 모두 Round 2 에서 APPROVE.
- **Custom-prompt 공개 차단 double-layer**: BE (be-001 409 CUSTOM_PROMPT_PUBLISH_BLOCKED) + FE (app-004 client-side check + defensive 409 핸들링) 이중 방어. 한쪽 변경으로 전체 breach 되지 않는 설계.

## What failed (with root cause)

- **Group 001 Round 1 Major 1 — sourceContentId Content 영구 저장 누락**: Contract 는 "Content 스키마에 필드 추가 + ContentSummary 에 포함" 명시했으나 구현자가 createOne 에 받지 않음 (setSourceContentId 메서드만 생성, 0 callsite). Root cause: **spec_ambiguity** — Contract 의 "DTO 필드 추가" 가 "behavior 호출 경로 연결" 을 명시적으로 포함하지 않음. → completeness-008 (fallback) + completeness-009 (dead hook) KB 등재.
- **Group 001 Round 1 Major 2 — FeedResponseDto Phase 2 5 필드 누락**: Contract §be-004 는 "모든 피드 엔드포인트" 요구. 구현자가 me-contents / users-public 만 반영. Root cause: **spec_ambiguity** — "모든" 의 구체 범위 전수 나열 부재. → completeness-010 KB 등재.
- **Group 002 Round 1 Major 1 — MY profile ownership threading 누락**: Contract 가 isOwn 판정 로직을 위임했으나 meme.mapper `userProfile.id=""` fallback 이 MY profile path 에서 항상 false. Root cause: **technical_limit** (mapper semantic-breaking fallback). → completeness-008 등재.
- **Group 002 Round 1 Major 3 — 신규 e2e flow 3개 미생성**: Contract §Scope 에 명시됐으나 FE Engineer 구현 누락. Root cause: **scope_creep** (E2E 생성이 별도 tracking 되지 않음). → Contract template 에 "E2E flows 체크리스트" 조항 추가 권장.

## Lesson (next-sprint actionable)

- **Phase 2 Spec 작성 시** Contract "DTO 추가" 조항에는 반드시 "callsite ≥ 1 hit" grep 게이트 + "fallback 금지" 조항 병기 (completeness-008/009 반영). Group 003 Contract 가 이를 선제 적용하여 first-try PASS.
- **Phase 4 Contract Round 1 review** 에서 "모든" / "전체" / "각" 포괄 표현 발견 시 구체 path 전수 나열 요구 (completeness-010 반영). Evaluator Round 1 checklist 에 항목 추가.
- **Phase 4 Evaluator Active Evaluation** 에서 신규 hook/method/factory callsite grep 게이트 의무. Dead-hook detection 을 V-method 표준 bullet 로 승격.
- **Phase 4 Evaluator Active Evaluation** 에서 entity 확장 mapper 의 fallback 패턴 (`?? 0`, `?? false`, `|| ""`) grep 0 hit 검증 표준화. Group 003 에서 실효 입증.
- **Phase 5 Manual QA**: AC-2.3 프로필 공유 / AC-7.4 404 는 ugc-platform-001 부터 2 스프린트 연속 pending. 다음 스프린트 PR 머지 전 QA 수행 결과를 PR comment 에 기록하는 프로토콜 도입.
- **Phase 6 KB Write**: completeness-008/009/010 3개 패턴 누적 → rubric v4 승격 후보. `completeness-008` 은 3회 관측 (Group 001/002/003 + Group 003 선제 방지) 로 가장 유력.

## Pointers

- Patterns: `learning/patterns/completeness-008.yaml` (fallback semantic), `completeness-009.yaml` (dead hook), `completeness-010.yaml` (cross-component scope)
- Rubric: `learning/rubrics/v3.md` (active). completeness-008 promotion 누적 1회 (본 스프린트 등재) — 다음 스프린트에서 재관측 시 v4 승격 트리거.
- Gap analysis: `sprint-orchestrator/sprints/ugc-platform-002/retrospective/gap-analysis.yaml`
- Pattern digest: `sprint-orchestrator/sprints/ugc-platform-002/retrospective/pattern-digest.yaml`
- REPORT: `sprint-orchestrator/sprints/ugc-platform-002/REPORT.md`
- PRs: backend #799 / app #562

> 직전 lesson 반영도: **fully** — ugc-platform-001 의 5 패턴 (cursor $lte, e2e harness, route param cascade, enabled gate, prop threading) 모두 Group 001~003 Contract 에 명시 반영됨. 특히 prop threading (C13) 은 `isOwnOverride` 구체 구현 패턴으로 발전. enabled gate (C12) 는 SwipeFeed 4 variant 에서 적용 검증.
