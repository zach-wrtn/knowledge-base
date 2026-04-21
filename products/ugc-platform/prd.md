---
product: ugc-platform
status: active
last_updated: "2026-04-21"
active_prds:
  - 33b0159c-6b59-8124-9f14-cbb4ac053ee5
  - 33b0159c-6b59-81c4-81b5-f75110a04872
  - 33b0159c-6b59-8195-98ed-e2ef56215d85
schema_version: 1
---

# ugc-platform — 제품 Overview

## 현재 상태

피드 공개 + 프로필 + 팔로우 + 좋아요 + 크레딧 페이백 + 알림 + 설정을 통해 **크리에이터 의존 없는 UGC 플랫폼**을 구축. 기능 범위가 커서 **3개 phase로 분리** 진행 중이며, 각 phase는 의존 순서가 있음 (Phase 1 → 2/3 병렬).

통합 마스터 문서 (비전·전체 KPI·Phase 관계)는 Notion의 "[AI UGC Platform - 통합](https://www.notion.so/AI-UGC-Platform-3280159c6b5981f68420fee7fa3a425e)" PRD가 SSOT. KB에서는 Phase PRD만 `active-prds/`로 mirror (통합 overview는 중복이므로 KB에 복제하지 않음).

## Active Feature PRDs (진행 중)

| Phase | Title | 최종수정 | Dep | Notion | Mirror |
|:-:|---|---|---|---|---|
| **1** | AI UGC Platform 1 — 프로필 & 네비게이션 | 2026-04-09 | 없음 (선행) | [↗](https://www.notion.so/AI-UGC-Platform-1-33b0159c6b5981249f14cbb4ac053ee5) | [`phase-1-profile/`](./phase-1-profile/prd.md) |
| **2** | AI UGC Platform 2 — 피드 인터랙션 & 페이백 | 2026-04-09 | Phase 1 완료 후 | [↗](https://www.notion.so/AI-UGC-Platform-2-33b0159c6b5981c481b5f75110a04872) | [`phase-2-feed-payback/`](./phase-2-feed-payback/prd.md) |
| **3** | AI UGC Platform 3 — 소셜 & 알림 | 2026-04-09 | Phase 1 완료 후 (Phase 2와 병렬 가능) | [↗](https://www.notion.so/AI-UGC-Platform-3-33b0159c6b59819598ede2ef56215d85) | [`phase-3-social-notification/`](./phase-3-social-notification/prd.md) |

### Phase 1 — 프로필 & 네비게이션
- **범위**: 앱 골격(3탭 탭바), MY 3탭, 프로필 편집, 타유저 프로필, 설정 화면
- **역할**: Phase 2·3의 선행 조건
- **KPI 기여**: UGC 플랫폼 기반 구축 → 유저 간 프로필 탐색 → 재생성 전환의 출발점

### Phase 2 — 피드 인터랙션 & 페이백
- **범위**: 공개/비공개 토글, CTA 분기, 재생성 추적, 좋아요, 크레딧 페이백(1%)
- **의존**: Phase 1 완료
- **KPI 기여**: 콘텐츠 풀 확대 + 크레딧 순환 루프 → 재생성 전환율↑, ARPPU↑

### Phase 3 — 소셜 & 알림
- **범위**: 팔로우, 차단/신고, 알림센터, 푸시 3종, 알림 설정
- **의존**: Phase 1 완료 (Phase 2와 병렬 가능)
- **KPI 기여**: 추천 시그널 확보(팔로우) + 재방문 유도(알림) → Retention↑, 피드 체류시간↑

## Related Sprints (완료 / 이력)

- 아직 완료 스프린트 없음 (Phase 1이 첫 구현 예정)

## Notion Catalogue

전체 ugc-platform 관련 PRD는 `products/notion-prds.yaml`에서 조회. 통합 overview Notion 페이지(`3280159c...`)는 이 overview에서 대체되므로 KB로 mirror하지 않음.

## 제품 경계

- **포함**: 콘텐츠 공개/비공개, 프로필·팔로우·좋아요·알림, 크레딧 페이백 루프
- **제외**: 콘텐츠 생성 플로우 자체(ai-webtoon / free-tab 참조), 크리에이터 전용 기능(플랫폼은 일반 유저 UGC 우선)

## 편집 규칙

상동 — `products/free-tab/prd.md`의 "편집 규칙" 섹션 참조. 추가로:
- **Phase 추가/축소**: Notion의 통합 PRD 문서가 reference. 신규 Phase PRD가 Notion에서 `진행 중`이 되면 (1) `zzem-kb:sync-active-prds` 재실행 → mirror 생성, (2) 이 파일의 `active_prds` + Phase 표에 추가.
