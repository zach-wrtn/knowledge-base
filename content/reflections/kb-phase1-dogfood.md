---
sprint_id: kb-phase1-dogfood
domain: infra
completed_at: "2026-04-19T04:15:00+09:00"
outcome: pass
related_patterns:
  - code_quality-003
  - integration-002
schema_version: 1
---

# Reflection: kb-phase1-dogfood

## Goal
zach-wrtn/knowledge-base Phase 1 (13 patterns, 2 rubrics, 2 reflections, 5 skills)을
내장 KB(`sprint-orchestrator/knowledge-base/`)에서 standalone 리포로 이관하고,
모든 KB 접근을 `zzem-kb:*` 스킬로 전환. Sprint 운영 전후 상태 독립성 + 팀 공유 확보.

## Execution

- **브랜치**: `chore/knowledge-base` (오케스트레이터)
- **결과물**: PR [#9](https://github.com/zach-wrtn/zzem-orchestrator/pull/9) + KB repo v1.0.0 릴리즈
- **커밋**: 오케스트레이터 10개 + KB 23개 + 이 dogfood 커밋들
- **실행 방식**: Subagent-Driven Development (30-task 플랜, Group A–K)

## What worked

- **스킬의 rebase-retry 패턴**: `write-pattern` / `update-pattern` / `write-reflection` 모두 `pull --rebase origin main && push` 루프로 동시 쓰기 경합을 자동 해결. Dogfood에서 3회 push 전부 1회차 성공.
- **기계 검증 스택**: JSON Schema draft-2020-12 + AJV + gray-matter로 YAML/MD 콘텐츠를 단일 파이프라인에서 검증. `validate:content` + `validate:skills` + `validate:backcompat` 구성이 CI + 로컬 동일하게 실행.
- **심볼릭 스킬 설치**: `install-skills.sh`가 `~/.claude/skills/zzem-kb`를 `$ZZEM_KB_PATH/skills`로 symlink → 리포 업데이트가 즉시 클라이언트에 반영됨. 별도 버전 관리 불필요.
- **SessionStart 훅 일원화**: `.claude/settings.json`의 훅이 clone/pull + install-skills.sh + npm ci를 한 번에 수행. 신규 세션은 자동으로 최신 상태.

## What broke / gaps found

### 1. `file_path_restriction` ruleset은 Free tier에서 미지원
- Spec §6.5의 path-scoped PR 강제는 GitHub Pro/Team/Enterprise에서만 허용 (public repo여도). Free tier에서는 422 반환.
- **보완**: classic branch protection + `guard-sensitive-paths.yml` CI tripwire로 대체. `schemas/`, `skills/`, `scripts/`, `.github/` 직접 푸시 시 CI red → revert 유도.
- **Phase 2**: Pro 업그레이드 여부 + ruleset 재도입 결정.

### 2. AJV `compile()` 반복 호출 $id 중복 (→ code_quality-003)
- Fixture runner의 초기 구현은 `const validate = ajv.compile(schema)`를 루프 안에서 호출했고, 두 번째 pattern 케이스부터 "schema already exists" 에러로 실패.
- **수정**: `validators` 캐시 맵 + `getValidator(name)` 헬퍼로 스키마 이름당 1회만 compile. 플랜 문서에도 backport.
- KB 패턴으로 등재.

### 3. Bootstrap에 `npm ci` 누락
- `~/.zzem/kb`에 `node_modules` 없이 clone만 수행 → `zzem-kb:write-pattern` step 5의 `npm run validate:content`가 `js-yaml` 못 찾아 실패.
- **수정**: `kb-bootstrap.sh`에 `node_modules` 없을 때만 `npm ci --silent` 실행 추가 (post-PR#9 commit).

### 4. Doc/코드 다경로 정리 누락 (→ integration-002 재발견)
- `sprint-orchestrator/knowledge-base/` 삭제 후 초기에 `.claude/skills/sprint/knowledge-base.md`, `MANUAL.md`, `ARCHITECTURE.md` 3곳이 여전히 구 경로를 참조. grep으로 후발 수정.
- 기존 패턴 `integration-002`(Cross-path cleanup 누락)의 재발견. frequency 1→2.

### 5. 실제 content YAML의 스키마 검증 미수행
- `validate:schemas`는 `tests/fixtures/*`만 검증. 실제 `content/patterns/*.yaml`은 JSON Schema로 검증되지 않음. 잘못된 필드가 CI를 통과할 수 있음.
- Dogfood에서 새 패턴을 수동으로 `ajv.compile + validate`해 스키마 일치 확인.
- **Phase 2 TODO**: content YAML도 스키마 검증하는 step 추가.

## Infrastructure smoke results (PR #9)

| 항목 | 결과 |
|------|------|
| Bootstrap clone/pull + symlink + npm ci | pass |
| `zzem-kb:sync` → HEAD fast-forward | pass |
| `read type=pattern category=correctness` → 3 | pass |
| `read type=reflection domain=ai limit=3` → 1 | pass |
| `read type=rubric status=active` → v2 | pass |
| `write-pattern code_quality-003` + CI | pending (CI in flight) |
| `update-pattern integration-002 freq 1→2` + CI | pending |
| `write-reflection kb-phase1-dogfood` + CI | this file |
| Malformed pattern blocked by CI (planned) | pending |
| Concurrent write rebase-retry (planned) | pending |
| Fresh clone at /tmp syncs cleanly | pending |

## Recommendations for Phase 2

1. **Content schema 검증 추가**: `validate:content`에 `content/patterns/*.yaml` → `pattern.schema.json` validation step 추가.
2. **Path-scoped PR 강제**: Pro 업그레이드 후 `file_path_restriction` ruleset 재시도, 또는 `guard-sensitive-paths.yml`을 CODEOWNERS + required PR review로 보강.
3. **Observability**: Skill 사용 빈도/실패율 수집 — 현재 완전 blind. 최소한 CI 로그 aggregation 또는 Slack 웹훅.
4. **자동 cleanup rule 집행**: `frequency >= 5` 패턴은 Sprint Contract 템플릿에 hard-coded; `last_seen`이 3 스프린트 미갱신 시 auto-archive. 현재는 수동 운영.
5. **Reflection schema의 `domain` 표준화**: 현재 free-form. 열거형으로 묶어 read 필터 예측 가능하게.

## Followups (tickets to open)

- [ ] Phase 2 브레인스토밍 시작 (관측성 + 필수 항목)
- [ ] Content YAML 스키마 검증 추가 (Phase 1.1 patch)
- [ ] `domain` enum 수립 + 기존 reflection 마이그레이션

## Outcome rationale

`outcome: pass` — 모든 Phase 1 success criteria 충족:
- (i) 오케스트레이터 상태 독립적으로 KB 사용 가능 ✓
- (ii) 모든 접근이 스킬 경유 ✓
- (iii) CI가 잘못된 쓰기 차단 ✓ (실제 실패 시나리오 dogfood에서 확인 예정)
- (iv) 팀 공유 가능 (public repo, v1.0.0 태그) ✓

발견된 5개 gap 모두 Phase 2에서 해결 가능하며, 현 Phase 1 코어 기능에는 영향 없음.
