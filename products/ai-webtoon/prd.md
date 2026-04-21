---
product: ai-webtoon
status: active
last_updated: "2026-04-21"
active_prds:
  - 3410159c-6b59-8192-9ea5-d198b3b9b244
schema_version: 1
---

# ai-webtoon — 제품 Overview

## 현재 상태

AI 웹툰은 유저 사진 1장 → AI 생성 1화 → "자동/직접 이어가기"로 연재를 형성하는 생성 흐름. 크레딧 재소비 유도가 핵심 KPI. 현재 v1.2 PRD가 진행 중이며 x-prd 표준 준수 + 피드백 반영.

## Active Feature PRDs (진행 중)

| Title | 최종수정 | Notion | Mirror |
|---|---|---|---|
| [Agent PRD] AI 웹툰 서비스 v1.2 | 2026-04-14 | [↗](https://www.notion.so/Agent-PRD-AI-v1-2-3410159c6b5981929ea5d198b3b9b244) | [`3410159c…`](../active-prds/3410159c6b5981929ea5d198b3b9b244.md) |

- **요약**: 사진으로 1화 생성 → 자동/직접 이어가기 연재, v1.2는 v1.1 피드백 전면 반영 + 2026-04-14 코드 확인 반영
- **KPI 기여**: 웹툰 생성 비중 10%+, 리텐션 플래토 형성, 크레딧 재구매 발생 여부

## Related Sprints (완료 / 이력)

- `ai-webtoon` (2026-04-01, completed) — 초기 출시 스프린트 (reflection 존재: `learning/reflections/ai-webtoon.md`)

## Notion Catalogue

전체 ai-webtoon 관련 PRD는 `products/notion-prds.yaml`에서 조회. 현재 진행 중은 위 1건이며 v1.1 이전 버전은 `상태 = 완료`로 전환된 상태.

## 제품 경계

- **포함**: 웹툰 생성 플로우(이미지→1화→이어가기), 연재 UX, 크레딧 소비 구조
- **제외**: 일반 밈 생성(별도 플로우), UGC 피드 공개(ugc-platform 참조)

## 편집 규칙

상동 — `products/free-tab/prd.md`의 "편집 규칙" 섹션 참조.
