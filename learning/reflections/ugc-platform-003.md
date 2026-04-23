---
sprint_id: ugc-platform-003
domain: ugc-platform
completed_at: '2026-04-23T00:00:00+09:00'
outcome: partial
related_patterns:
- correctness-004
- correctness-005
- completeness-008
- completeness-011
- completeness-012
schema_version: 1
---
# Reflection: ugc-platform-003

> Date: 2026-04-23
> Sprint: ugc-platform-003 (UGC Platform Phase 3 — 소셜 & 알림)
> Domain: ugc-platform (follow-up of ugc-platform-002)

## What worked

- **Lessons 선제 반영으로 2 consecutive first-try PASS**: Group 001 의 M1 (cursor) + M2 (E2E appId) lesson 을 Group 002 Contract drafting 에 명시적으로 반영 (contract file 의 "Group 001 Lessons Applied" 섹션). 결과: Group 002 + Group 003 모두 first-try PASS (fix_loop=0). ugc-platform-002 의 "Prior-group lessons 선제 적용" 패턴이 third sprint 에서도 재입증.
- **Slot-based composition for shared component coordination**: app-004 의 `middleSlot` + app-007 의 `topSlot` additive pattern 으로 `ComingSoonSettingsSection` 의 canonical order 보존 + 병렬 merge 충돌 없음. 2 group 이 같은 파일 수정하는 high-risk 시나리오가 pragma 설계로 conflict-free 해결. skill_candidate (composition helper).
- **BlockRelationPort dual-provider pragmatic pattern**: circular DI 발견 시 useFactory (shared repository 경유) + useExisting alias 로 회피. Evaluator 가 "결과 동치 + 주석 명시" 기준으로 pragmatic 수용. 장기적 refactor 는 KB Minor 로 이월하되 현 스프린트 속도 유지.
- **Contract field-level 파일 경로 명시**: Group 002 Contract 가 UserPublicProfile 확장 파일 경로를 구체 지정 (ugc-platform-002 retrospective lesson 반영) → Group 002 는 재발 없음. Group 001 은 file path 미지정 → Contract deviation (Minor) 발생. 효과 직접 증명.

## What failed (with root cause)

- **Group 001 Round 1 Major 1 — cursor encoding semantic 이탈**: formal grep gate (`$lt` 0 hit) 통과하나 `truncated[last-shown]` vs `page[limit]` extra item 규약 불일치. Root cause: **spec_ambiguity** — Contract 의 correctness-004 clause 가 연산자 축만 다루고 item selection 축은 reference 구현에 implicit. → correctness-005 KB 신규 등재 (reference 파일 경로 명시 의무).
- **Group 001 Round 1 Major 2 — E2E appId inconsistency**: 신규 2 yaml 이 canonical 값과 불일치. Root cause: **scope_creep** — 신규 flow 작성 시 기존 flow reference 복사 workflow 부재. → completeness-011 신규 등재 (uniformity grep gate 표준화).
- **Group 004 Round 1 Major 1 — test assertion literal drift**: reconciliation 단계에서 production 상수는 교체됐지만 test 파일의 hardcoded literal 미업데이트. Root cause: **spec_ambiguity** — reconciliation checklist 에 test 파일 포함 미명시. → completeness-012 신규 등재 (typed import 강제).
- **AC 6.2 partial (nickname sort)**: BE 가 createdAt DESC 로 임시 구현, 가나다순 (nickname ASC) 미이행. Root cause: **technical_limit** (cross-domain join precedent 부재 — $lookup(UserProfile) aggregation 신규 패턴). TODO 주석으로 이월.

## Lesson (next-sprint actionable)

- **Contract §Cursor Pagination 조항**: 단순 `$lt` grep 외에 reference 파일 경로 명시 의무 (correctness-005). 신규 buildListResponse 작성 시 previous group 의 helper 를 mirror 하는 workflow.
- **Contract §E2E 조항**: appId uniformity grep gate 표준화 (completeness-011). 기존 flow reference 복사 workflow.
- **Contract §Default Verification Gates 조항**: 테스트 파일 typed import 강제 (completeness-012). Spec 수정 시 reconciliation checklist 에 test 파일 포함.
- **Phase 2 Spec 작성 시 Contract "DTO 확장" 조항에는 파일 경로 + 필드 name 을 구체 명시** (Group 001 Minor deviation 재발 방지). Group 002 에서 이미 긍정 precedent.
- **Phase 5 rebase 선행** (사용자 directive 2026-04-23): backend=apple, app=epic/ugc-platform-final. 이번 스프린트는 no-op 이었으나 향후 long-running 스프린트에 필수.
- **Manual QA carryover 종결**: AC-2.3 / AC-7.4 Phase 1 inherited 가 3 스프린트 carryover. 다음 스프린트 start 시 PR merge 전 manual QA 수행 + PR comment 결과 기록 필수.

## Pointers

- Patterns: `learning/patterns/correctness-005.yaml` (cursor reference), `completeness-011.yaml` (E2E appId), `completeness-012.yaml` (test literal drift)
- Updated patterns: `correctness-004.yaml` (freq 1→2), `completeness-008.yaml` (freq 2→3 — **rubric v4 승격 후보 2nd entry**)
- Rubric: `learning/rubrics/v3.md` (active). completeness-008 promotion 누적 2회 (ugc-platform-002 + 003) — 다음 스프린트 재관측 시 v4 bump.
- Gap analysis: `sprint-orchestrator/sprints/ugc-platform-003/retrospective/gap-analysis.yaml`
- Pattern digest: `sprint-orchestrator/sprints/ugc-platform-003/retrospective/pattern-digest.yaml`
- REPORT: `sprint-orchestrator/sprints/ugc-platform-003/REPORT.md`
- PRs: backend #804 / app #563

> 직전 lesson 반영도: **fully** — ugc-platform-002 의 6 pattern (completeness-008/009/010, correctness-004, integration-002, storage primitive) 중 실제 재발 Major 는 cursor semantic violation (correctness-004 축 확장) 1건만. grep gate 뿐인 formal check 한계를 reference 파일 경로 명시로 보완하는 correctness-005 신규 패턴이 이번 스프린트의 가장 중요한 학습.
