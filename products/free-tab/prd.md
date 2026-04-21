---
product: free-tab
status: active
last_updated: "2026-04-21"
active_prds:
  - 33e0159c-6b59-8143-bd62-c4c136d72bd8
schema_version: 1
---

# free-tab — 제품 Overview

## 현재 상태

무료탭은 유저가 "오늘의 무료 필터"로 콘텐츠를 탐색하고 무료 생성 기회를 소비하는 핵심 인입 경로. 현재는 단일 PRD(`x-prd-v2`)가 활성 상태로, 필터 편성·배너·재방문 유도 플로우 전면 개편이 진행 중.

## Active Feature PRDs (진행 중)

| Title | 최종수정 | Notion | Mirror |
|---|---|---|---|
| [Agent PRD] 무료탭 필터선택 다양화 | 2026-04-17 | [↗](https://www.notion.so/Agent-PRD-33e0159c6b598143bd62c4c136d72bd8) | [`filter-diversification/`](./filter-diversification/prd.md) |

- **요약**: 무료탭 필터를 하루 1개 → 10개로 확장, 테마별 자동 편성 + SwipeFeed 탐색 + 1일 1회 무료 생성 구조 전환
- **KPI 기여**: 무료탭 DAU·재방문율(D1/D7) 상승 + 무료→유료 전환율 개선

## Related Sprints (완료 / 이력)

- `free-tab-diversification` (2026-04, completed) — x-prd-v2 Phase 1 구현 스프린트

## Notion Catalogue

전체 free-tab 관련 PRD(완료/홀딩 포함)는 `products/notion-prds.yaml`에서 조회 — `domain: ZZEM` 필터 후 title에 "무료"/"free" 키워드로 수렴.

## 제품 경계

- **포함**: 무료탭 전용 UX, 무료 필터 편성·스케줄러, 1일 1회 무료 생성 기회, 무료→유료 CTA 분기
- **제외**: 유료 크레딧 결제 플로우, 추천탭 알고리즘(무료 필터 노출 정책만 연동), 어드민(별도 운영 제품)

## 편집 규칙

- **이 파일**: 제품 overview. 제품 상태/경계 변경, 신규 active PRD 추가·제거 시 hand-edit.
- **feature PRD 본문**: Notion SSOT. 이 파일에서 복제하지 말 것. `products/active-prds/`의 mirror는 `zzem-kb:sync-active-prds`가 자동 갱신.
- `active_prds` frontmatter 배열은 Notion page id와 일치. Notion에서 `상태 = 진행 중`이 아닌 PRD는 여기서 제거.
