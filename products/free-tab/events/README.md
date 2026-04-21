# free-tab Event Design

> free-tab 프로덕트의 이벤트 로깅 설계 문서 인덱스.
> 머신 리더블 카탈로그는 `catalog.yaml` (스키마 검증 대상).

## 파일 구성

| 구분 | 파일 | 역할 |
|------|------|------|
| 카탈로그 | [`./catalog.yaml`](./catalog.yaml) | 이벤트 이름/트리거/파라미터 — 스키마 검증 대상 |
| Rationale (Feature 별) | [`./meme-app-home.md`](./meme-app-home.md) | home feature 설계 근거, PRD 매핑, 리뷰 결과 |
| Rationale (Feature 별) | [`./meme-app-swipe-feed.md`](./meme-app-swipe-feed.md) | swipe-feed feature 설계 근거, cross-feature funnel |
| 상위 | [`../prd.md`](../prd.md) | 제품 overview |
| 상위 | [`../filter-diversification/prd.md`](../filter-diversification/prd.md) | PRD 본문 (Notion 미러, 자동 동기화) |

## 설계 프로세스

1. **Context Injection** — PRD (`../filter-diversification/prd.md`) + 브랜치 코드 변경 델타 주입
2. **Event Design 초안** — Feature 별 EventCandidate 리스트 구성
3. **Governance + Completeness 병렬 리뷰** — 네이밍/PII/카디널리티/Logger 배분 + PRD KPI 커버리지/journey 완결성/funnel_id 연결
4. **설계문서 추출** — rationale 문서 (이 디렉토리) + 카탈로그 (catalog.yaml) 동기 산출

자세한 스킬은 `app-core-packages/.claude/skills/event-design/` 참조.

## PRD 연계

- **PRD 원본 (Notion SSOT):** [Agent PRD — 무료탭 필터선택 다양화](https://www.notion.so/Agent-PRD-33e0159c6b598143bd62c4c136d72bd8)
- **PRD KB 미러:** [`../filter-diversification/prd.md`](../filter-diversification/prd.md)
- **구현 PR:** [app-core-packages#527](https://github.com/wrtn-tech/app-core-packages/pull/527)

## 변경 요약

| Feature | 파일 | new | modified | deprecated |
|---------|------|-----|----------|------------|
| home | `meme-app-home.md` | 4 | 2 | 10 |
| swipe-feed | `meme-app-swipe-feed.md` | 3 | 3 | 4 |
| **합계** | — | **7** | **5** | **14** |

(`reuse` 이벤트는 `catalog.yaml` 제외 — 기존 기능의 이벤트를 재활용하는 것이므로 제품 카탈로그의 일부가 아님. Rationale 문서 §5 에서만 명시.)

## 다음 단계 (구현 PR)

1. EventSpec 타입 정의 갱신 (new 7 + modified 5, deprecated 14 에 `@deprecated` JSDoc)
2. `track()` 호출 사이트 갱신 (기존 `trackFree*` 제거, 신규/modified 발화)
3. Cross-feature funnel_id 배선 (home `click_meme_filter.imp_id` → swipe-feed `view_free_swipefeed_page.funnel_id`)
4. 구현 완료 후 `/event-design MemeApp home` 재실행하여 reverse-grep 자동 검증
