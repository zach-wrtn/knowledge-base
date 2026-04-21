---
feature: swipe-feed
app: MemeApp
owner: unassigned
pr_url: https://github.com/wrtn-tech/app-core-packages/pull/527
prd_ref: products/free-tab/filter-diversification/prd.md
kb_product: free-tab
source_code: https://github.com/wrtn-tech/app-core-packages (apps/MemeApp/src/presentation/swipe-feed/)
base_branch: main
generated_at: 2026-04-17
generated_by: event-design v2
supersedes: swipe-feed.md v1 (2026-03-19, 11 events)
---

# swipe-feed Event Design

> 대상 코드: `apps/MemeApp/src/presentation/swipe-feed/` ([GitHub](https://github.com/wrtn-tech/app-core-packages/tree/main/apps/MemeApp/src/presentation/swipe-feed))
> 관련 EventSpec: `apps/MemeApp/src/shared/loggers/event-spec/index.ts`
> PRD: [./filter-diversification/prd.md](./filter-diversification/prd.md) (Notion 미러, 자동 동기화)
> 이벤트 카탈로그: [./events.yaml](./events.yaml)
> 관련 피쳐: [./MemeApp-home.md](./MemeApp-home.md) — 무료 생성 플로우는 home 과 swipe-feed 에 걸쳐 있음
> v1 설계서와 병합 — v1 의 11개 이벤트는 §5 "reuse" 로 이관. 본 문서는 브랜치 델타 (`main...HEAD`) 로 발생한 free 모드 변경분을 다룬다.

---

## 1. 변경 요약

| 구분              | 개수 | 세부                                                                                                                                |
| ----------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 신규 (new)        | 3    | `view_free_swipefeed_page`, `imp_free_swipefeed_cta_btn`, `click_free_swipefeed_cta_btn`                                            |
| 수정 (modified)   | 3    | `imp_vertical_feed_filter` (+`feed_mode?`), `swipe_vertical_feed` (+`feed_mode?`), `click_vertical_feed_action_btn` (+`feed_mode?`) |
| 재활용 (reuse)    | 5    | `view_meme_filter_detail_page`, `generate_done`, `view_meme_generate_fail_page`, `view_login_page`, `view_paywall_page`             |
| 제거 (deprecated) | 4    | `free_swipe_enter`, `free_swipe_view`, `free_swipe_dwell`, `free_cta_tap`                                                           |

### 브랜치 변경 파일 델타

- `swipe-feed.screen.tsx` — `type === "free"` 모드 분기, circular scroll (무한 루프), free mode 에서 기존 `imp_vertical_feed_filter` / `swipe_vertical_feed` 호출이 가드로 비활성화 → **본 설계로 재활성화 (feed_mode 디스크리미네이터 추가)**
- `components/swipe-feed-free-footer.tsx` — CTA 버튼 + confirm/credit 바텀시트 트리거 + 게스트 → 로그인 + 약관 + 이미지 가이드 + 이미지 픽 + 크롭 + `generateMeme`
- `components/swipe-feed-free-item.tsx` — Video/Image 표시 + preload/nearby 최적화 (순수 UI, 이벤트 없음)
- `components/swipe-feed-free-actions.tsx` — more 아이콘, filter detail 라우트 (`click_vertical_feed_action_btn` 재활용)
- `components/swipe-feed-cta-button.tsx` — `isFree` prop 으로 ticket/coin 아이콘 전환

### PRD 연계

- **KPI (후속 측정):** "탐색 동기 / 재방문율" — `feed_mode=free` 분리 측정으로 무료 vs 유료 vs 추천 모드별 비교 가능
- **커버된 User Stories:**
  - US-2 (그리드 → SwipeFeed → CTA → confirm → 생성) — `view_free_swipefeed_page`, `imp/click_free_swipefeed_cta_btn`
  - US-3 (SwipeFeed 상하 탐색, 그리드 복귀) — `imp_vertical_feed_filter`, `swipe_vertical_feed` (feed_mode=free 활성화)
  - US-6 (사용 완료 후 유료 CTA) — `click_free_swipefeed_cta_btn.is_free: false`
  - US-7 (추천탭 등 외부 진입점 동일 경험, BR-14) — `view_free_swipefeed_page.entry_point`

---

## 2. 이벤트 목록

| #    | Event Name                                                                         | 변경 유형  | Trigger                                   | Params                                                                                                                         | Loggers                       | 구현 위치                                                                   | Owner      | 상태                                                     |
| ---- | ---------------------------------------------------------------------------------- | ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| 1    | `view_free_swipefeed_page`                                                         | new        | 무료 SwipeFeed 진입 (mount 1회)           | `service_detail`, `filter_id`, `filter_title`, `entry_point`, `total_filter_count_bucket`, `has_used_free_today`, `funnel_id?` | mixpanel, airbridge, firebase | `swipe-feed.screen.tsx` free mode `useEffect([])`                           | unassigned | 미구현                                                   |
| 2    | `imp_free_swipefeed_cta_btn`                                                       | new        | 무료 SwipeFeed CTA 노출                   | `service_detail`, `filter_id`, `is_free`, `imp_id`                                                                             | mixpanel                      | `swipe-feed-free-footer.tsx` `ImpressionView wrap`                          | unassigned | 미구현                                                   |
| 3    | `click_free_swipefeed_cta_btn`                                                     | new        | CTA 탭 → confirm/credit 바텀시트          | `service_detail`, `filter_id`, `is_free`, `imp_id`                                                                             | mixpanel                      | `swipe-feed-free-footer.tsx` `handleCta`                                    | unassigned | 미구현                                                   |
| 4    | `imp_vertical_feed_filter`                                                         | modified   | 세로 피드 필터 노출 (스냅마다)            | 기존 + `feed_mode?` 🆕                                                                                                         | mixpanel, airbridge, firebase | `swipe-feed.screen.tsx` `handleViewableItemsChanged` (free mode guard 제거) | unassigned | 미구현                                                   |
| 5    | `swipe_vertical_feed`                                                              | modified   | 세로 스와이프                             | 기존 + `feed_mode?` 🆕                                                                                                         | mixpanel, airbridge, firebase | `swipe-feed.screen.tsx`                                                     | unassigned | 미구현                                                   |
| 6    | `click_vertical_feed_action_btn`                                                   | modified   | 액션 버튼 (more, filter_detail, share 등) | 기존 + `feed_mode?` 🆕                                                                                                         | mixpanel, airbridge, firebase | `swipe-feed-actions` + `swipe-feed-free-actions.tsx`                        | unassigned | 구현 완료 (free mode call-site 에만 feed_mode 추가 필요) |
| 7-10 | `free_swipe_enter` / `free_swipe_view` / `free_swipe_dwell` / `free_cta_tap` (4개) | deprecated | (§6 Migration Notes 참조)                 | —                                                                                                                              | —                             | `utils/free-tab-events.ts` (전체 삭제 대상, home.md 와 공유)                | —          | —                                                        |

---

## 3. Params 상세

### `view_free_swipefeed_page` (new)

| Param                       | 타입                                       | 필수     | 설명                                                              |
| --------------------------- | ------------------------------------------ | -------- | ----------------------------------------------------------------- |
| `service_detail`            | `"filter"`                                 | ✓        | feature 영역 (기존 filter 서비스와 정합)                          |
| `filter_id`                 | `string`                                   | ✓        | 진입 시 첫 필터 ID                                                |
| `filter_title`              | `string`                                   | ✓        | 필터명                                                            |
| `entry_point`               | `"grid_feed" \| "recommend" \| "deeplink"` | ✓        | 진입 경로 (PRD BR-14 / US-7 분기 분석)                            |
| `total_filter_count_bucket` | `"1-5" \| "6-10" \| "11-20" \| "20+"`      | ✓        | 무료 필터 총 개수 (bucket — 카디널리티 방지)                      |
| `has_used_free_today`       | `boolean`                                  | ✓        | 무료 사용 여부 (is_free CTA 분기 기대치)                          |
| `funnel_id`                 | `string`                                   | optional | home `click_meme_filter.imp_id` 로부터 전달 (`grid_feed` 진입 시) |

> **`view_meme_filter_detail_page` 와의 구분 근거:** 기존 `view_meme_filter_detail_page` 는 단일 필터 상세(프리뷰) 화면 진입 이벤트. `view_free_swipefeed_page` 는 **여러 필터를 circular scroll 로 탐색하는 전용 피드** 진입 이벤트. 사용자 경험/목적/후속 퍼널이 달라 별도 이벤트로 유지 (Governance 리뷰 duplicate warn 에 대한 rationale). 향후 두 이벤트의 분석 쿼리가 통합 가능하면 migration 검토.

### `imp_free_swipefeed_cta_btn` / `click_free_swipefeed_cta_btn` (new, pair)

| Param            | 타입       | 필수 | 설명                                                       |
| ---------------- | ---------- | ---- | ---------------------------------------------------------- |
| `service_detail` | `"filter"` | ✓    | feature                                                    |
| `filter_id`      | `string`   | ✓    | 현재 SwipeFeed 필터                                        |
| `is_free`        | `boolean`  | ✓    | `!hasUsedFreeToday` — 무료 CTA (ticket) vs 유료 CTA (coin) |
| `imp_id`         | `string`   | ✓    | imp↔click 연결 (ImpressionView 가 자동 생성)              |

### `imp_vertical_feed_filter` / `swipe_vertical_feed` / `click_vertical_feed_action_btn` (modified)

기존 스펙에 아래 optional 파라미터 추가:

| Param          | 타입                                      | 필수     | 설명                                                                                                               |
| -------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `feed_mode` 🆕 | `"free" \| "paid" \| "recommend" \| null` | optional | 피드 모드 분기 (US-3 / US-6 / BR-14 분석). **기존 호출처 전수 업데이트 필요 없음 — null 허용으로 backward-compat** |

> **Breaking 여부:** Non-breaking. 기존 호출처는 `feed_mode` 를 보내지 않아도 정상 동작. 무료 모드 호출처에만 `feed_mode: "free"` 를 추가한다. 점진적 롤아웃 후 분석 필요 시 required 로 승격.

---

## 4. funnel_id 흐름

| 출발 이벤트                                                               | 도착 이벤트                                                    | 전달 방식                                                    | 피쳐 경계                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `click_meme_filter` (home, imp_id: X)                                     | `view_free_swipefeed_page` (funnel_id: X)                      | `navigation.navigate("SwipeFeed", { ..., funnelId: impId })` | home → swipe-feed                      |
| `click_free_swipefeed_cta_btn` (imp_id: Y)                                | `expose_free_confirm_sheet` (home, funnel_id: Y)               | props 전달 (모달 오픈 시)                                    | swipe-feed → home                      |
| `click_free_swipefeed_cta_btn` (imp_id: Y)                                | `expose_free_credit_sheet` (home, funnel_id: Y)                | props 전달                                                   | swipe-feed → home (is_free=false 분기) |
| `click_vertical_feed_action_btn({ button_name: "filter_detail" })`        | `view_meme_filter_detail_page`                                 | navigation params                                            | swipe-feed → meme                      |
| `click_vertical_feed_action_btn({ button_name: "generate" })` (실패 분기) | `view_meme_generate_fail_page`                                 | navigation (내부 상태 전환)                                  | swipe-feed → meme                      |
| `click_free_swipefeed_cta_btn` (게스트)                                   | `view_login_page` (entry_point: "filter_detail", funnel_id: Y) | `navigation.navigate("Login", { entryPoint, funnelId })`     | swipe-feed → auth                      |

> `view_login_page.entry_point` union 에 `"free_generation"` 추가는 **auth feature 소관** — 본 문서에서는 `"filter_detail"` 재사용 (현재 구현). auth feature 재설계 시 분리 검토.

---

## 5. 기존 이벤트 재활용 (reuse)

v1 의 11개 이벤트는 모두 유효 — 본 브랜치에서 free mode 확장은 `feed_mode?` optional 추가로만 통합됨:

| Event Name                                                                                                          | v1 정의 상태               | 본 브랜치 변경 영향                                                                              | 스펙 변경                                                   |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `imp_vertical_feed_filter`                                                                                          | v1 §2 #1                   | free mode 활성화 (기존 guard 제거)                                                               | modified (feed_mode?)                                       |
| `swipe_vertical_feed`                                                                                               | v1 §2 #2                   | free mode 활성화                                                                                 | modified (feed_mode?)                                       |
| `click_vertical_feed_action_btn` (audio/like/share/feedback/report/filter_detail/generate/regenerate — 8개 variant) | v1 §2 #3-10                | 기존 호출처 그대로 + free mode 호출처에만 `feed_mode: "free"` 전달                               | modified (feed_mode?)                                       |
| `generate_done`                                                                                                     | v1 §2 #11                  | swipe-feed-free-footer mutation onSuccess 에서 호출 (deprecated `free_generation_complete` 대체) | 변경 없음                                                   |
| `expose_image_attached_allow_modal` / `click_image_attached_allow_modal`                                            | v1 §5                      | free mode CTA → 권한 확인에서 호출                                                               | 변경 없음                                                   |
| `screen_visit_duration`                                                                                             | v1 §5 (자동)               | free mode 도 자동 기록 (deprecated `free_swipe_dwell` 대체)                                      | 변경 없음                                                   |
| `view_meme_filter_detail_page`                                                                                      | 기존                       | `click_vertical_feed_action_btn({ button_name: "filter_detail" })` 이후 도착점                   | 변경 없음 (기존 `funnel_id?` 활용)                          |
| `view_meme_generate_fail_page`                                                                                      | 기존                       | 생성 실패 시 도착점 (AC 2.2.11)                                                                  | `funnel_id?` + `is_free?` 추가 검토 (v3, meme feature 소관) |
| `view_login_page`                                                                                                   | 기존 (`entry_point` union) | 게스트 CTA 탭 시 진입                                                                            | 변경 없음                                                   |
| `view_paywall_page`                                                                                                 | 기존 (`funnel_id?`)        | 크레딧 부족 시 도착점 (home `click_free_credit_btn` 경유)                                        | 변경 없음                                                   |

---

## 6. Migration Notes (modified / deprecated)

### `imp_vertical_feed_filter` / `swipe_vertical_feed` / `click_vertical_feed_action_btn` (modified)

| 이전        | 이후                                                       | Breaking?              | Analytics 영향                                                       | 대응 기한 |
| ----------- | ---------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- | --------- |
| 기존 params | + `feed_mode?: "free"\|"paid"\|"recommend"\|null` optional | **No** (optional 추가) | 기존 대시보드 영향 없음. `feed_mode IS NOT NULL` 필터로 새 분석 가능 | 구현 PR   |

### Deprecated 4종 — Param 매핑표 + 제거 시점

> **제거 원칙:** 1주 grace period. 동일 PR 내 신규 이벤트 치환 후 1주 내 EventSpec 타입 정의 제거. `utils/free-tab-events.ts` 파일은 home.md 와 공유 (총 10 + 4 = 14 함수 동시 삭제).

| Deprecated Event   | 호출처 현황                                 | 대체 이벤트                                                    | Param 매핑                                                                                                                                             | 제거 타이밍                |
| ------------------ | ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `free_swipe_enter` | 호출처 없음                                 | `view_free_swipefeed_page`                                     | `initialFilterId` → `filter_id`. `totalFilterCount` → `total_filter_count_bucket`. `hasUsedFreeToday` → `has_used_free_today`. `sessionId` DROP        | 즉시 삭제 가능 (호출 없음) |
| `free_swipe_view`  | 호출처 없음                                 | `imp_vertical_feed_filter({ feed_mode: "free" })`              | `filterId` → `filter_id`. `filterTitle` → `filter_title`. `slotIndex`/`viewIndex`/`viewDwellMs` DROP (imp 단위로 충분)                                 | 즉시 삭제 가능             |
| `free_swipe_dwell` | 호출처 없음                                 | `screen_visit_duration` (자동 추적)                            | —                                                                                                                                                      | 즉시 삭제 가능             |
| `free_cta_tap`     | `swipe-feed-free-footer.tsx:422` **active** | `click_free_swipefeed_cta_btn({ filter_id, is_free, imp_id })` | `filterId` → `filter_id`. `isFree` → `is_free`. `viewsBeforeCta` DROP (session 분석으로 이관). `sessionId` DROP. `imp_id` 신규 (ImpressionView 로부터) | 치환 PR + 1주              |

### EventSpec 정리 작업

home.md §6 와 동기화 — `event-spec/index.ts` 482~565 의 15개 `free_*` 타입은 home (10) + swipe-feed (4) + 공유 1 = 일괄 삭제 대상. 치환 PR 머지 후 1주 내 제거.

---

## 7. 구현 제외 이벤트 (설계 의도적 배제)

| Event 후보                                                                | 제외 사유                                                                                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `free_generate_abort({ stage, reason })` (AC 2.2.6~2.2.11 실패/취소 경로) | 실패 경로 추적은 **생성 플로우 전반 재설계**가 필요하며 본 브랜치 범위 외. v3 백로그. `view_meme_generate_fail_page` (기존) + `is_free?` 추가 검토 |
| `imp_toast({ toast_name: "concurrent_slot_full" })` (AC 2.2.9)            | 토스트 전용 이벤트 시스템은 앱 전반의 별도 설계 필요. 현재는 `screen_visit_duration` + 실패 이벤트로 간접 추적                                     |
| SwipeFeed page_leave 이벤트                                               | `screen_visit_duration` 으로 duration + history 자동 기록. 별도 이벤트 불필요                                                                      |
| 더블탭 좋아요                                                             | v1 §7 과 동일 — `click_vertical_feed_action_btn(like)` 로 커버                                                                                     |
| 코치마크 노출/닫기                                                        | v1 §7 과 동일 — 첫 진입 UX, 반복 분석 가치 낮음                                                                                                    |

---

## 8. 거버넌스 리뷰 결과 (Step 3a)

> Governance Reviewer Agent 원문. 수정 사항 반영 완료:
>
> - `feed_mode: required` → **`optional`** 로 전환 → breaking 해제 (FAIL 해소)
> - deprecated 4종 모두 §6 에 매핑표 + 제거 타이밍 추가 → FAIL 해소
> - `imp/click_free_swipefeed_cta_btn` 로거를 **mixpanel 단독** 으로 정리 → WARN 해소
> - `total_filter_count: number` → `total_filter_count_bucket` bucket 화 → cardinality WARN 해소

**Overall (수정 전):** FAIL (3 pass / 3 warn / 3 fail)
**Overall (수정 후 예상):** PASS

#### 수정 전 주요 Issue

| #   | Event                              | Check                 | Severity | Reason                                          | Fix 반영 여부                                                  |
| --- | ---------------------------------- | --------------------- | -------- | ----------------------------------------------- | -------------------------------------------------------------- |
| 1   | `imp_vertical_feed_filter`         | deprecated (breaking) | fail     | `feed_mode: required` 는 기존 호출처에 breaking | ✅ optional 로 전환                                            |
| 2   | `swipe_vertical_feed`              | deprecated (breaking) | fail     | 동일                                            | ✅ optional                                                    |
| 3   | `free_swipe_enter/view`            | deprecated migration  | fail     | 매핑표/제거 시점 부재                           | ✅ §6 매핑표 추가                                              |
| 4   | `view_free_swipefeed_page`         | duplicate             | warn     | 기존 `view_meme_filter_detail_page` 와 70% 겹침 | ✅ §3 에 구분 rationale 명시 (circular feed vs single preview) |
| 5   | `view_free_swipefeed_page`         | cardinality           | warn     | `total_filter_count: number` 카디널리티         | ✅ `total_filter_count_bucket` 로 변경                         |
| 6   | `imp/click_free_swipefeed_cta_btn` | logger                | warn     | 로거 세트 비대칭 (imp=mp, click=mp+ab+fb)       | ✅ 둘 다 mixpanel 단독으로                                     |
| 7   | `free_cta_tap`                     | deprecated            | warn     | 호출처 active 인데 제거 순서 미명시             | ✅ §6 "치환 PR + 1주" 명시                                     |

---

## 9. 완결성 리뷰 결과 (Step 3b)

> Completeness Reviewer Agent 원문 요약. 11 issues 중 **5건 반영 / 4건 cross-feature 참조 / 2건 v3 이연**.

**PRD:** `apps/MemeApp/docs/prds/PRD-free-tab-filter-diversification.md`

#### 반영 (5건)

- `view_free_swipefeed_page.entry_point` 필수화 → BR-14 / US-7 분기 측정 가능
- `imp/click_free_swipefeed_cta_btn.is_free: boolean` 추가 → US-6 무료/유료 전환율 분리 측정
- `click_vertical_feed_action_btn.feed_mode?` modified → actions 에서도 free 모드 분기 가능
- `total_filter_count_bucket` bucket 화 → 카디널리티 방지하면서 탐색 깊이 추적 가능
- 5개 funnel_id 경로 §4 에 명시 (home↔swipe-feed cross-feature 포함)

#### Cross-feature 참조 (4건)

- 확인/크레딧 바텀시트 이벤트는 **home feature (home.md)** 에 분리 귀속. swipe-feed 는 CTA click 까지만 책임. 이중 트래킹 방지
- `view_meme_filter_detail_page.funnel_id?` 활용 — meme feature 소관, 기존 스펙 확인
- `view_meme_generate_fail_page` — meme feature 소관, `is_free?` 추가는 v3
- `view_login_page.entry_point = "free_generation"` — auth feature 소관 modify, 본 브랜치는 기존 `"filter_detail"` 재사용

#### v3 이연 (2건)

- `free_generate_abort` 실패/취소 경로 (AC 2.2.6~2.2.11)
- `page_leave` 이벤트로 탐색 깊이(swipe count before leave) 직접 측정 — `screen_visit_duration` + `imp_vertical_feed_filter` 조합으로 간접 측정 가능

---

## 10. 체크리스트

- [x] 1단계 — context 수집 (변경 파일 5개, PRD, PR #527)
- [x] 2단계 — 이벤트 후보 설계 (10개, change_type 분류)
- [x] 3단계 — Governance + Completeness 병렬 리뷰 통과 (FAIL 전건 해소)
- [x] 4단계 — 이 설계서 최종본 저장
- [ ] 5단계 — EventSpec 타입 정의 + track() 구현 (`--doc` 모드로 스킬 skip)
- [ ] 6단계 — tsc / reverse-grep / 리뷰 문서 생성 (`--doc` 모드로 스킬 skip)

**`--doc` 모드.** 구현은 별도 PR 에서 진행 권장. 실제 구현 시 home.md + swipe-feed.md 의 cross-feature funnel_id 연결 (home `click_meme_filter.imp_id` ↔ swipe-feed `view_free_swipefeed_page.funnel_id`) 을 동일 PR 에서 배선해야 전환 퍼널이 깨지지 않는다.
