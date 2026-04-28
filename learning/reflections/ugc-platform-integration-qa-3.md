---
sprint_id: ugc-platform-integration-qa-3
domain: ugc-platform
completed_at: '2026-04-28T15:30:00+09:00'
outcome: partial
related_patterns:
- correctness-003
- correctness-007
- completeness-015
- edge_case-004
- edge_case-005
schema_version: 1
---

# Reflection: ugc-platform-integration-qa-3

> Date: 2026-04-28
> Sprint: ugc-platform-integration-qa-3 (UGC Platform Phase2 QA-498 후속, type=qa-fix)
> Domain: ugc-platform (follow-up of ugc-platform-integration-qa-2)
> Outcome: partial — 16/36 fulfilled (44.4%) + 1 partial + 19 deferred. P1 7건 중 6건 fix.

## What worked

- **Codebase pre-grep before contract 패턴 검증**: group-005 lessons #1 ("Stage 3 contract 작성 시 가짜 경로 금지, Round 1 review 의 codebase findings 사전 inline") 을 group-007 에서 적용 → first-try PASS, fix loop 0회. group-005 에서 Round 1 이 잡았던 10 issue 가 group-007 에서 0 으로 감소. **모든 후속 그룹 (002/003/001) 도 first-try PASS** (전체 7/7 그룹 fix loop 0). 다음 스프린트 phase-qa-fix Stage 3 default workflow 화 권고.
- **Read-only sub-agent 병렬 investigation 효율 (5 그룹 적용)**: 4 sub-agent (Explore) parallel dispatch 로 4영역 root cause 가설을 ~80~104초 wall time 에 확보. main agent 직접 sequential 보다 ~3x 빠름. fabrication 우려 영역 (Jira write, 코드 수정) 은 main 직접 처리하여 read-vs-write 책임 분리. group-002/003/006 모두 이 패턴으로 진행 — 1차 NEEDS-INFO 결론이 틀렸을 때 parallel session 이 정확한 fix 발견 (group-006 IS-1395).
- **NEEDS-INFO vs DEFERRED-BE classification 일관성 (7 그룹 전반)**: code-trace 가능 + BE 수정만 = DEFERRED-BE / code-vs-policy mismatch + reporter 정책 미정 = NEEDS-INFO. 두 분류 모두 transition 보류 → Phase 5/Retro 까지 sticky. 19/36 deferred 가 의도된 분류 — fabrication 위험 회피.
- **Strict schema gate 보존 (Group 002 M1 패턴 재확인)**: IS-1377 P1 임에도 FE skip-on-error 로 회귀 마스킹 회피하고 DEFERRED-BE 분류. P 레벨 무관 design gate 우선 원칙. correctness-007 신규 KB 등재로 영구화.
- **Defense-in-depth 패턴 (IS-1407)**: BE single-chokepoint validation + FE 사전 falsy/empty guard 이중 방어. native bridge crash 의 root + symptom 양쪽 차단. edge_case-004 신규 KB 등재.

## What failed (with root cause)

- **Group 002 inline ADF JSON 한글 escape corruption**: 6개 게시 시 inline 재타이핑으로 한글 typo 발생 ("썸네일"→"주마일", "컨텐츠"→"컴텐츠"). Root cause: **technical_limit** — Jira ADF JSON 의 한글 unicode escape 가 일부 글자 깨짐. → group-003/001 에서는 `cat /tmp/<key>.adf.json` 출력 그대로 paste → typo 0 회복. Lesson: inline 재타이핑 금지, local SSOT → cat | paste 패턴 표준화.
- **VPN/.env.e2e 부재로 E2E full-suite gate skip**: Phase 5 PR 생성 시 풀스위트 회귀 검증 미수행. Root cause: **dependency** — dev-auth-api 도달 불가 + .env.e2e 캐시 파일 부재 (양쪽 worktree 모두). 보완: ticket 단위 atomic commit + jest regression guard 2건 (IS-1402 active-generations status=error, IS-1381 밈 상세 재생성 버튼). 향후 sprint 진입 시 .env.e2e 캐시 파일 사전 확보 권고.
- **15/36 BE 의존 (5 DEFERRED-BE) + 디자인/정책 의존 (5 NEEDS-INFO)**: FE 단독으로 처리 불가능한 영역이 사실상 절반. Root cause: **dependency + spec_ambiguity** — QA 라운드에서 FE-only fix 가능한 비율 한계. Lesson: 다음 sprint 는 BE round + 디자인 batch 결정을 선행해야 FE QA 라운드에서 fix-rate 회복.
- **IS-1395 1차 NEEDS-INFO 오진**: group-006 P1 본 session 의 sub-agent 가 narrow scope (필터 row 만) 로 grep → swipe-feed-persona 까지 확장 grep 부재로 NEEDS-INFO 결론. parallel session 이 정확한 fix 발견. Root cause: **scope_creep** — sub-agent dispatch 시 repro path 의 모든 진입점 grep 미요청. Lesson: sub-agent 프롬프트에 "repro path 의 모든 진입점 grep" 명시.

## Lesson (next-sprint actionable)

- **phase-qa-fix Stage 3 step 추가**: "codebase pre-grep before contract" 명시화. Contract 작성 시 모든 경로/라인이 grep 결과로 검증되어야 함. group-005 → group-007 효과 검증.
- **phase-qa-fix Stage 4 default workflow**: "investigation = parallel read-only sub-agents, write = main agent" 분리 원칙. sub-agent 프롬프트에 "repro path 의 모든 진입점 grep" 명시 (group-006 IS-1395 오진 회피).
- **phase-qa-fix Stage 5 close 매트릭스**: NEEDS-INFO vs DEFERRED-BE classification rubric 명문화. 두 분류 모두 transition 절대 금지 (R_QA 요청 안 함). transitions-pending.md 추적.
- **Jira ADF post 표준 패턴**: local SSOT (`qa-fix/jira-comments/<TICKET>.md` → `.adf.json` 변환) → `cat /tmp/<key>.adf.json` 출력 그대로 paste. inline 재타이핑 금지.
- **E2E .env.e2e 캐시 파일 사전 확보**: 다음 long-running sprint 진입 시 worktree 양쪽에 .env.e2e cache 사전 복사. VPN/dev-auth-api 가용성 미확정 환경에서 Phase 5 e2e gate 보장.
- **BE round 우선순위**: IS-1377 (P1 strict schema 회귀) > IS-1411 (push pipeline) > IS-1397 (nickname contract) > IS-1419 (cascade) > P2 BE 의존 7건. 다음 sprint 는 BE-only 라운드로 분리 권고.
- **디자인/PM 결정 batch**: IS-1387/1420/1410/1379/1378 (5건) — 한 디자인 리뷰 라운드에서 일괄 결정. NEEDS-INFO 분류는 design 결정 게이트가 fix 전제.

## Pointers

- Patterns (new): `correctness-007`, `completeness-015`, `edge_case-004`, `edge_case-005`
- Patterns (updated): `correctness-003` (freq 1→2, last_seen=ugc-platform-integration-qa-3)
- Rubric: `learning/rubrics/v3.md` (active). 본 sprint 에서 promotion log 2건 추가 (correctness-007 C17, correctness-003 2nd entry). 누적 < 2 (per-pattern) — v4 bump 미수행.
- Gap analysis: `sprint-orchestrator/sprints/ugc-platform-integration-qa-3/retrospective/gap-analysis.yaml`
- Pattern digest: `sprint-orchestrator/sprints/ugc-platform-integration-qa-3/retrospective/pattern-digest.yaml`
- Deferred items: `sprint-orchestrator/sprints/ugc-platform-integration-qa-3/retrospective/deferred-items.yaml`
- REPORT: `sprint-orchestrator/sprints/ugc-platform-integration-qa-3/REPORT.md`
- PRs: backend [#869](https://github.wrtn.club/wrtn-tech/wrtn-backend/pull/869) / app [#601](https://github.com/wrtn-tech/app-core-packages/pull/601)
- Transitions pending: `sprint-orchestrator/sprints/ugc-platform-integration-qa-3/qa-fix/transitions-pending.md` (16 R_QA + 16 보류)

> 직전 lesson 반영도: **partially** — ugc-platform-integration-qa-2 의 6 inherited patterns 중 strict schema gate 패턴 (correctness-007 의 root family) 은 본 sprint 에서 4회 재발하여 KB 영구화로 전환. codebase pre-grep 패턴은 group-007 에서 first-try PASS 로 효과 검증되었으나 group-005 에서는 lessons 적용 전 sprint 라 불가. 다음 sprint 는 entry phase 부터 적용 예정.
