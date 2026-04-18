---
sprint_id: ai-webtoon
domain: ai
completed_at: '2026-04-01T00:00:00+09:00'
outcome: pass
schema_version: 1
---
# Reflection: ai-webtoon

> Date: 2026-04-15
> Sprint: ai-webtoon
> Domain: ZZEM AI 웹툰 (사진 1장 → 1화 + 자동/직접 이어가기)

## What worked

- **Shared credit/concurrency/HMAC helper 재사용**: be-003 continuation submit이 `CreditDomainService.deductCredit`(contentId idempotency 내장), `countAllInProgressByUser + countInFlightByUser`, `hmac.util` verifySignature를 **zero 포크**로 그대로 소비. 두 번째 submit-like 엔드포인트가 logic drift 없이 붙었고, 평가 시 credit 정합성 검증이 be-002에서 이미 증명되어 recheck 범위 축소.
- **Race-safe append pattern**: atomic `$inc` + unique `(seriesId, episodeNumber)` 복합 인덱스 백스톱. 5-parallel 스펙 테스트로 `[1..5] monotone no-dup` 검증. 이 패턴이 be-002 submit / be-003 continuation 양쪽에서 재사용되어 단조 번호 부여가 정확히 한 지점에서 일어남.
- **단일 polling hook `useWebtoonGenerationPolling(generationId)`**: app-002 generate 화면과 app-003 inline episode section이 같은 훅을 generationId param만 바꿔 소비. AppState listener + 240s client timeout + credit invalidation(once) 모두 공통 내장 — fix loop 0.

## What failed (with root cause)

- **G002-M1 Concurrency cap source drift** — webtoon submit이 DB-sum precheck만 사용, meme는 Redis atomic slot. 공유 cap인데 counter source 분리. → root_cause: `dependency` (meme pipeline의 slot primitive가 webtoon으로 확장되지 않음).
- **G002-M2 episodeNumber gap on insert failure** — `$inc` → insert 2-step 사이 실패 window. unique 인덱스는 중복 방어하지만 counter 갭은 남음. → root_cause: `spec_ambiguity` (Contract가 'no gap' vs 'label' 입장을 선언하지 않음).
- **G003-M1 Retry CTA가 MANUAL intent 손실** — retry handler가 하드코드 AUTO. agent inline comment가 simplification임을 자각하면서도 채택. → root_cause: `scope_creep` (AC는 "동일 continuationType으로 재요청" 명시 — 구현이 out-of-AC).
- **G003-M2 `hasUnseenEpisode` dual flip site** — `incrementLastEpisode` $set이 PENDING 시점에 true, `markHasUnseenTrue`가 COMPLETED 시점에 또 true. PENDING→FAILED 경로에서 false-positive N-badge 누수. → root_cause: `scope_creep` (Hint '단일 domain helper' 를 Done Criteria 수준으로 승격하지 않음).

## Lesson (next-sprint actionable)

- **Concurrency slot primitive는 Contract 수준에서 통합**: 같은 cap을 공유하는 두 pipeline은 "동일한 atomic counter source" 조항을 Contract Done Criteria에 명시. DB-sum preflight alone은 금지.
- **State transition helper는 single-write-path 검증을 spec에 요구**: 도메인 플래그(`hasUnseenEpisode`, `creditDeducted` 등)는 "단일 domain-service helper에서만 flip" 조항을 Hint → Done Criteria로 승격. Evaluator가 grep으로 복수 write site 검사.
- **Retry/재시도 CTA의 intent preservation을 AC에 명시**: 재시도는 원래 mode/payload 보존이 기본. "silent fallback to default" 는 금지. 1-line Done Criteria로 고정.
- **2-step atomic sequence는 gap 정책을 Contract에 선언**: counter `$inc` 다음 insert가 분리되면, (a) compensating `$dec` 또는 (b) "gap 허용 + schema 주석" 둘 중 하나를 Contract에서 택일.

## Pointers

- Pattern digest: `sprints/ai-webtoon/retrospective/pattern-digest.yaml` (7 patterns; 4 major regressions + 3 positive reuse patterns)
- Gap analysis: `sprints/ai-webtoon/retrospective/gap-analysis.yaml` (22 AC, 18 fulfilled, 4 partially)
- Deferred items: `sprints/ai-webtoon/retrospective/deferred-items.yaml` (5 deferred AC + 10 improvements)
- KB patterns referenced/updated: `integration-003` (cap source drift, new), `edge-case-001` (counter-gap, new), `completeness-004` (retry intent loss, new), `code-quality-002` (dual flip site, new); positive reuse patterns tracked in digest.
- PRs: sprint-orchestrator #8, wrtn-backend #752, app-core-packages #516

> 직전 lesson 반영도: **free-tab-diversification (2026-04-14)** 의 C5 "복수 경로 cleanup 의무 명시" 는 본 스프린트에서 credit/concurrency helper 재사용 형태로 자연스럽게 반영됨(be-003 zero-fork). 반면 C6 "폴백 응답 pricing 규칙 명시" 와 유사한 *state-transition 단일 flip 규칙* 은 명시적 Contract 조항으로 승격하지 않아 G003-M2 재발생 — 다음 스프린트에서 **"도메인 state 플래그는 단일 helper"** 조항을 Rubric v2로 승격 필요.
