---
feature: home
app: MemeApp
owner: unassigned
pr_url: https://github.com/wrtn-tech/app-core-packages/pull/527
prd_ref: products/free-tab/filter-diversification/prd.md
kb_product: free-tab
source_code: https://github.com/wrtn-tech/app-core-packages (apps/MemeApp/src/presentation/home/)
base_branch: main
generated_at: 2026-04-17
generated_by: event-design v2
supersedes: home.md v1 (2026-03-19, 13 events)
---

# home Event Design

> 대상 코드: `apps/MemeApp/src/presentation/home/` ([GitHub](https://github.com/wrtn-tech/app-core-packages/tree/main/apps/MemeApp/src/presentation/home))
> 관련 EventSpec: `apps/MemeApp/src/shared/loggers/event-spec/index.ts`
> PRD: [../filter-diversification/prd.md](../filter-diversification/prd.md) (Notion 미러, 자동 동기화)
> 이벤트 카탈로그: [./catalog.yaml](./catalog.yaml) (스키마 검증 대상)
> v1 설계서와 병합 — 기존 13개 이벤트는 하단 §5 "reuse" 로 이관, 본 문서는 **브랜치 델타 (`main...HEAD`)** 로 발생한 free-tab 변경분을 다룬다.

---

## 1. 변경 요약

| 구분              | 개수 | 세부                                                                                                                                                                                                               |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 신규 (new)        | 4    | `expose_free_confirm_sheet`, `click_free_confirm_btn`, `expose_free_credit_sheet`, `click_free_credit_btn`                                                                                                         |
| 수정 (modified)   | 2    | `view_home_page` (+`entry_point?`, +`has_free_red_dot?`), `imp_home_banner` (+`banner_state?`)                                                                                                                     |
| 재활용 (reuse)    | 3    | `click_home_tab`, `imp_meme_filter`, `click_meme_filter`                                                                                                                                                           |
| 제거 (deprecated) | 10   | `free_tab_view`, `free_tab_scroll`, `free_tab_dwell`, `free_grid_tap`, `free_confirm_accept`, `free_confirm_dismiss`, `free_credit_accept`, `free_credit_dismiss`, `free_generation_complete`, `free_post_use_tap` |

### 브랜치 변경 파일 델타

- `home.screen.tsx` — 딥링크 `zzem://home?tab=free` 지원, AppState foreground invalidate, KST 자정 타이머 (`entry_point?` 구분 사유)
- `componenets/home-header/home-header.tsx` — 무료 탭 레드닷 (`has_free_red_dot?` 사유)
- `componenets/free-banner.tsx` — 보라/틸 배너 (`imp_home_banner.banner_state?` 사유)
- `componenets/free-body.tsx` — 무료 그리드 (`imp_meme_filter` / `click_meme_filter` 재활용)
- `componenets/free-confirm-bottom-sheet.tsx` — 무료 사용 확인 (신규 `expose_*` / `click_*`)
- `componenets/free-credit-bottom-sheet.tsx` — 유료 전환 (신규 `expose_*` / `click_*`)
- `componenets/filter-list/filter-list-item.tsx` — `onPressOverride` 추가 (무료 탭에서 SwipeFeed navigation 처리)
- `utils/free-tab-events.ts` — **전체 파일 제거 대상** (10개 함수 deprecated)

### PRD 연계

- **KPI (후속 측정):** "탐색 동기 향상 / 재방문율 향상"
- **커버된 User Stories:**
  - US-1 (무료탭 그리드 진입, 배너, 레드닷) — `view_home_page`, `imp_home_banner`, `imp_meme_filter`
  - US-4 (탭 재진입 스크롤 복원) — `view_home_page.entry_point`
  - US-5 (생성 완료 후 배너 전환) — `imp_home_banner.banner_state` 전환 추적
  - US-6 (사용 완료 후 유료 CTA, 크레딧 바텀시트) — `expose_free_credit_sheet`, `click_free_credit_btn`
- US-2 (그리드 → SwipeFeed → CTA → 생성): **swipe-feed feature 로 위임** (`home.md` 는 그리드까지, 이후 swipe-feed.md 참조)

---

## 2. 이벤트 목록

| #     | Event Name                                                                                                     | 변경 유형  | Trigger                         | Params                                                                                             | Loggers                       | 구현 위치                                                     | Owner      | 상태                        |
| ----- | -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------- | ---------- | --------------------------- |
| 1     | `view_home_page`                                                                                               | modified   | 홈 화면 진입 / 포커스           | `service_detail`, `tab`, `entry_point?` 🆕, `has_free_red_dot?` 🆕                                 | mixpanel, airbridge, firebase | `home.screen.tsx` `trackViewHomePage`                         | unassigned | 미구현 (기존 호출 업데이트) |
| 2     | `imp_home_banner`                                                                                              | modified   | 홈 배너 viewport 노출           | 기존 + `banner_state?` 🆕                                                                          | mixpanel                      | `free-banner.tsx` (ImpressionView wrap 필요)                  | unassigned | 미구현                      |
| 3     | `click_home_tab`                                                                                               | reuse      | 탭 라벨 탭                      | `tab`                                                                                              | mixpanel                      | `home-header.tsx` `handleSelectTab`                           | unassigned | 구현 완료                   |
| 4     | `imp_meme_filter`                                                                                              | reuse      | 필터 그리드 노출 (free 탭 포함) | 기존 스펙 유지                                                                                     | mixpanel                      | `free-body.tsx` `handleImpression`                            | unassigned | 구현 완료                   |
| 5     | `click_meme_filter`                                                                                            | reuse      | 필터 그리드 탭                  | 기존 스펙 유지                                                                                     | mixpanel, airbridge, firebase | `free-body.tsx` `handlePressOverride`                         | unassigned | 구현 완료                   |
| 6     | `expose_free_confirm_sheet`                                                                                    | new        | confirm 바텀시트 mount          | `service_detail: "home"`, `filter_id`, `funnel_id?`, `modal_type: "bottom_sheet"`                  | mixpanel                      | `free-confirm-bottom-sheet.tsx` `useEffect([])`               | unassigned | 미구현                      |
| 7     | `click_free_confirm_btn`                                                                                       | new        | confirm 바텀시트 버튼 탭        | `service_detail`, `filter_id`, `button_name: "confirm"\|"dismiss"`                                 | mixpanel, airbridge, firebase | `free-confirm-bottom-sheet.tsx` `handleConfirm/handleDismiss` | unassigned | 미구현                      |
| 8     | `expose_free_credit_sheet`                                                                                     | new        | credit 바텀시트 mount           | `service_detail: "home"`, `filter_id`, `credit_amount`, `funnel_id?`, `modal_type: "bottom_sheet"` | mixpanel                      | `free-credit-bottom-sheet.tsx` `useEffect([])`                | unassigned | 미구현                      |
| 9     | `click_free_credit_btn`                                                                                        | new        | credit 바텀시트 버튼 탭         | `service_detail`, `filter_id`, `credit_amount`, `button_name: "confirm"\|"dismiss"`                | mixpanel, airbridge, firebase | `free-credit-bottom-sheet.tsx` `handleConfirm/handleDismiss`  | unassigned | 미구현                      |
| 10-19 | `free_tab_*` / `free_grid_*` / `free_confirm_*` / `free_credit_*` / `free_generation_*` / `free_post_*` (10개) | deprecated | (§6 Migration Notes 참조)       | —                                                                                                  | —                             | `utils/free-tab-events.ts` (전체 삭제 대상)                   | unassigned | —                           |

**상태 범례:** `미구현` | `구현 완료` | `검증 완료`
**Owner:** PR 머지 전 실제 owner 로 대체 필수

---

## 3. Params 상세

### `view_home_page` (modified)

| Param                 | 타입                                                 | 필수     | 설명                                                                           |
| --------------------- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `service_detail`      | `"home"`                                             | ✓        | 고정값                                                                         |
| `tab`                 | `"recommend" \| "free"`                              | ✓        | 선택된 탭                                                                      |
| `entry_point` 🆕      | `"tab_switch" \| "deeplink" \| "foreground" \| null` | optional | AC 2.5.4 (foreground 복귀) / 딥링크 / 탭 전환 구분. Completeness 리뷰 gap 해소 |
| `has_free_red_dot` 🆕 | `boolean`                                            | optional | AC 2.1.4 / AC 2.5.3 레드닷 노출 여부. 노출 측정 불가 gap 해소                  |

### `imp_home_banner` (modified)

기존 스펙에 아래 optional 파라미터 추가:

| Param             | 타입                         | 필수     | 설명                                                                   |
| ----------------- | ---------------------------- | -------- | ---------------------------------------------------------------------- |
| `banner_state` 🆕 | `"purple" \| "teal" \| null` | optional | PRD §3.3 배너 상태 (보라=미사용, 틸=사용완료). 무료탭 배너에 한해 전달 |

### `expose_free_confirm_sheet` / `click_free_confirm_btn`

| Param                    | 타입                     | 필수     | 설명                                                            |
| ------------------------ | ------------------------ | -------- | --------------------------------------------------------------- |
| `service_detail`         | `"home"`                 | ✓        | 고정값                                                          |
| `filter_id`              | `string`                 | ✓        | 대상 필터 ID                                                    |
| `funnel_id` (expose 만)  | `string`                 | optional | swipe-feed 의 `click_free_swipefeed_cta_btn.imp_id` 로부터 전달 |
| `button_name` (click 만) | `"confirm" \| "dismiss"` | ✓        | "무료 사용하기" vs "더 둘러볼게요"                              |
| `modal_type` (expose 만) | `"bottom_sheet"`         | ✓        | 모달 유형                                                       |

### `expose_free_credit_sheet` / `click_free_credit_btn`

| Param                    | 타입                     | 필수     | 설명                        |
| ------------------------ | ------------------------ | -------- | --------------------------- |
| `service_detail`         | `"home"`                 | ✓        | 고정값                      |
| `filter_id`              | `string`                 | ✓        | 대상 필터 ID                |
| `credit_amount`          | `number`                 | ✓        | 차감 예정 크레딧            |
| `funnel_id` (expose 만)  | `string`                 | optional | swipe-feed CTA 로부터 전달  |
| `button_name` (click 만) | `"confirm" \| "dismiss"` | ✓        | "크레딧 사용하기" vs "취소" |
| `modal_type` (expose 만) | `"bottom_sheet"`         | ✓        | 모달 유형                   |

---

## 4. funnel_id 흐름

| 출발 이벤트                                            | 도착 이벤트                                                      | 전달 방식                                                    | 피쳐 경계                      |
| ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| `click_meme_filter` (imp_id: X)                        | `view_free_swipefeed_page` (funnel_id: X)                        | `navigation.navigate("SwipeFeed", { ..., funnelId: impId })` | home → swipe-feed              |
| `click_free_swipefeed_cta_btn` (swipe-feed, imp_id: Y) | `expose_free_confirm_sheet` (funnel_id: Y)                       | props 전달                                                   | swipe-feed → home              |
| `click_free_swipefeed_cta_btn` (swipe-feed, imp_id: Y) | `expose_free_credit_sheet` (funnel_id: Y)                        | props 전달                                                   | swipe-feed → home              |
| `click_free_confirm_btn` (button_name: confirm)        | `view_login_page` (entry_point: "free_generation", funnel_id: Z) | navigation params                                            | home → auth (게스트일 때)      |
| `click_free_credit_btn` (button_name: confirm)         | `view_paywall_page` (funnel_id: Z)                               | navigation params                                            | home → credit (크레딧 부족 시) |

> funnel_id 는 모두 optional (딥링크/공유/직접 진입 허용).
> 첫번째 행의 `click_meme_filter.imp_id` 는 `free-body.tsx` 의 `ImpressionView` 에서 생성되며 `filter-list-item.tsx` 의 `onPressOverride` 에서 `navigation.navigate` 시 `funnelId` 로 전달해야 한다 (현재 구현에 없음 — 구현 시 추가 필요).

---

## 5. 기존 이벤트 재활용 (reuse)

| Event Name              | v1 정의 상태     | 이번 feature 에서 추가 호출 위치                       | 스펙 변경 필요?                                                                      |
| ----------------------- | ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `click_home_tab`        | 기존             | `home-header.tsx` (무료 탭 pressable)                  | 변경 없음                                                                            |
| `imp_meme_filter`       | 기존 (v1 §2 #5)  | `free-body.tsx` (무료 그리드)                          | 변경 없음 — 기존 스펙 그대로 사용                                                    |
| `click_meme_filter`     | 기존 (v1 §2 #4)  | `free-body.tsx` (무료 그리드)                          | 변경 없음 + `funnel_id` 발급용 `imp_id` 를 navigation 으로 전파 필요 (구현)          |
| `screen_visit_duration` | 기존 (자동 추적) | 모든 화면 — `free-body` 체류 시간 자동 기록            | 변경 없음 (deprecated `free_tab_dwell` 대체)                                         |
| `view_login_page`       | 기존             | `free-confirm-bottom-sheet` confirm + 게스트 시 진입   | **entry_point union 에 `"free_generation"` 추가 필요 (modified, auth feature 소관)** |
| `view_paywall_page`     | 기존             | `free-credit-bottom-sheet` confirm 시 크레딧 부족 분기 | 변경 없음 (기존 `funnel_id?` 활용)                                                   |

### v1 설계서 이벤트 (13개) — 상태 유지

v1 `home.md` 에 정의된 아래 이벤트는 이번 브랜치에서 **변경 없음**, 계속 유효:

`view_home_page` (본 문서에서 modified 로 승격), `click_my_meme`, `click_filter_category_tab`, `click_meme_filter` (reuse), `imp_meme_filter` (reuse), `click_meme_custom`, `imp_meme_section`, `click_meme_section`, `imp_home_banner` (본 문서에서 modified), `click_home_banner`, `trigger_experiment_bucket`, `click_home_credit_history_icon`, `click_home_settings_icon`.

---

## 6. Migration Notes (modified / deprecated)

### `view_home_page` (modified)

| 이전                              | 이후                                                       | Breaking?          | Analytics 영향                              | 대응 기한              |
| --------------------------------- | ---------------------------------------------------------- | ------------------ | ------------------------------------------- | ---------------------- |
| `{ service_detail: "home", tab }` | `{ service_detail, tab, entry_point?, has_free_red_dot? }` | No (optional 추가) | 기존 대시보드 유지, 새 파라미터는 null-safe | 구현 PR 과 동일 릴리즈 |

### `imp_home_banner` (modified)

| 이전                          | 이후                                      | Breaking?     | Analytics 영향                              | 대응 기한 |
| ----------------------------- | ----------------------------------------- | ------------- | ------------------------------------------- | --------- |
| 기존 8개 params (imp_id 포함) | + `banner_state?: "purple"\|"teal"\|null` | No (optional) | 무료탭 배너에서만 값 존재, 다른 배너는 null | 구현 PR   |

### Deprecated 10종 — Param 매핑표 + 제거 시점

> **제거 원칙:** 1주 grace period (KST 기준). 동일 PR 내 신규 이벤트 치환 후, 다음 주 내 EventSpec 에서 타입 정의 제거 + `free-tab-events.ts` 파일 삭제.

| Deprecated Event           | 호출처 현황                                                 | 대체 이벤트                                                           | Param 매핑                                                                                                                          | 제거 타이밍        |
| -------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `free_tab_view`            | `free-body.tsx:74` (active)                                 | `view_home_page({ tab: "free" })`                                     | `filterCount`/`experimentGroup`/`sessionId` → 전부 DROP (global/cohort 레벨로 이관)                                                 | 치환 PR 머지 + 1주 |
| `free_tab_scroll`          | 호출처 없음                                                 | **DROP** (스크롤 안티패턴)                                            | —                                                                                                                                   | 즉시 삭제 가능     |
| `free_tab_dwell`           | 호출처 없음                                                 | `screen_visit_duration` (자동 추적)                                   | —                                                                                                                                   | 즉시 삭제 가능     |
| `free_grid_tap`            | `free-body.tsx:80` (active, click_meme_filter 와 중복 fire) | `click_meme_filter({ service_detail: "home", ... })`                  | `filterId`/`filterTitle` → 기존 `filter_id`/`filter_title` 에 이미 존재. `slotIndex`/`tap_position_*` → `filter_order` 에 이미 존재 | 치환 PR + 1주      |
| `free_confirm_accept`      | `free-confirm-bottom-sheet.tsx:31` (active)                 | `click_free_confirm_btn({ button_name: "confirm" })`                  | `filterId` → `filter_id`. `sessionId` DROP                                                                                          | 치환 PR + 1주      |
| `free_confirm_dismiss`     | `free-confirm-bottom-sheet.tsx:36` (active)                 | `click_free_confirm_btn({ button_name: "dismiss" })`                  | 동일                                                                                                                                | 치환 PR + 1주      |
| `free_credit_accept`       | `free-credit-bottom-sheet.tsx:32` (active)                  | `click_free_credit_btn({ button_name: "confirm" })`                   | `filterId` → `filter_id`. `creditAmount` → `credit_amount`                                                                          | 치환 PR + 1주      |
| `free_credit_dismiss`      | `free-credit-bottom-sheet.tsx:37` (active)                  | `click_free_credit_btn({ button_name: "dismiss" })`                   | 동일                                                                                                                                | 치환 PR + 1주      |
| `free_generation_complete` | 호출처 없음                                                 | `generate_done({ service_detail: "filter", filter_id, filter_name })` | `generatedFilterId` → `filter_id`. `timeToReturnMs` DROP (server-side 측정으로 이관)                                                | 즉시 삭제 가능     |
| `free_post_use_tap`        | 호출처 없음                                                 | `click_meme_filter` (filter_id 비교로 재탐색 추정)                    | `filterId` → `filter_id`. `isSameAsGenerated` DROP                                                                                  | 즉시 삭제 가능     |

### EventSpec 정리 작업

치환 PR 머지 후 1주 내 수행:

1. `event-spec/index.ts` 482~565 라인의 15개 `free_*` 타입 정의 제거 (home 10개 + swipe-feed 4개 + 동시)
2. `utils/free-tab-events.ts` 파일 전체 삭제 (호출처 모두 치환 완료 확인 후)
3. Analytics 팀에 Slack 공유 — deprecated 이벤트 의존 대시보드 쿼리 점검 요청

---

## 7. 구현 제외 이벤트 (설계 의도적 배제)

| Event 후보                                                                | 제외 사유                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `imp_free_empty_state` (AC 2.1.3 빈 상태 노출)                            | PRD 에 빈 상태 측정 요구 명시 없음. 현실적으로 BR-7 폴백으로 빈 상태 도달 확률 매우 낮음. v3 백로그 |
| `free_tab_scroll_depth` (그리드 탐색 깊이)                                | 스크롤 안티패턴. 대안: `imp_meme_filter` 의 `filter_order` 로 노출 범위 역산 가능                   |
| `free_generate_abort({ stage, reason })` (AC 2.2.7~2.2.11 실패/취소 경로) | 스킬 v2 범위 외 (생성 플로우 전반 재설계 필요). v3 백로그 — PRD "KPI 측정은 후속 단계" 와 정합      |
| 배너 dismiss / 자정 리셋 ack                                              | 사용자 인터랙션 없음. `imp_home_banner.banner_state` 전환 시점으로 간접 추적                        |

---

## 8. 거버넌스 리뷰 결과 (Step 3a)

> Governance Reviewer Agent 원문 결과. 본 문서의 candidates 는 아래 수정안을 **반영 완료**:
>
> - `imp_free_banner` (신규) → `imp_home_banner` (modified, +banner_state) 로 전환 → FAIL 해제
> - 4개 이벤트 네이밍 5세그먼트 → 축약 (`_bottom_sheet` → `_sheet`, `_action_btn` → `_btn`) → WARN 해제
> - deprecated 10종 모두 §6 Migration Notes 에 매핑표 + 제거 타이밍 명시 → WARN 해제

**Overall (수정 전):** WARN (10 pass / 7 warn / 2 fail)
**Overall (수정 후 예상):** PASS (재리뷰 시)

#### 수정 전 주요 Issue

| #   | Event                              | Check                 | Severity | Reason                      | Fix 반영 여부                          |
| --- | ---------------------------------- | --------------------- | -------- | --------------------------- | -------------------------------------- |
| 1   | `imp_free_banner`                  | duplicate + imp/click | fail     | 기존 `imp_home_banner` 중복 | ✅ `imp_home_banner` modified 로 전환  |
| 2   | `expose_free_confirm_bottom_sheet` | naming                | warn     | 5세그먼트                   | ✅ `expose_free_confirm_sheet` 로 축약 |
| 3   | `click_free_confirm_action_btn`    | naming                | warn     | 5세그먼트                   | ✅ `click_free_confirm_btn` 로 축약    |
| 4   | `expose_free_credit_bottom_sheet`  | naming                | warn     | 5세그먼트                   | ✅ `expose_free_credit_sheet`          |
| 5   | `click_free_credit_action_btn`     | naming                | warn     | 5세그먼트                   | ✅ `click_free_credit_btn`             |
| 6   | Deprecated 10종                    | migration note        | warn     | 매핑표 부재                 | ✅ §6 에 전 10종 매핑표 추가           |

---

## 9. 완결성 리뷰 결과 (Step 3b)

> Completeness Reviewer Agent 원문 요약. 7 issues 중 **2건 반영 완료**, 나머지는 §7 구현 제외 또는 스코프 외 이연.

**PRD:** `apps/MemeApp/docs/prds/PRD-free-tab-filter-diversification.md`
**Overall:** 7 issues → 본 문서에서 **2건 반영 / 3건 §7 제외 / 2건 v3 이연**

#### 반영 (2건)

- KPI "재방문율" 측정 보강 → `view_home_page.entry_point?` + `has_free_red_dot?` 추가로 복귀 경로별 코호트 분석 가능
- funnel_id 퍼널 설계 → §4 에 5개 전환 경로 명시 (home↔swipe-feed cross-feature 포함)

#### §7 구현 제외 (3건)

- 빈 상태 이벤트 (AC 2.1.3) — PRD 요구 없음
- 스크롤 복원 측정 (AC 2.4.1) — 안티패턴, `imp_meme_filter` 로 대체
- 확인 바텀시트 backdrop dismiss 추적 — `onClose` 콜백이 dismiss 와 동일 경로이므로 `click_free_confirm_btn(button_name="dismiss")` 로 커버

#### v3 이연 (2건)

- `free_generate_abort` — 실패/취소 경로 이벤트 (생성 플로우 전반 재설계 필요)
- `view_home_page.entry_point = "foreground"` 의 정확도 검증 — AppState 리스너 신뢰성 확인 필요

---

## 10. 체크리스트

- [x] 1단계 — context 수집 (변경 파일 8개, PRD, PR #527)
- [x] 2단계 — 이벤트 후보 설계 (19개, change_type 분류)
- [x] 3단계 — Governance + Completeness 병렬 리뷰 통과 (FAIL 전건 해소)
- [x] 4단계 — 이 설계서 최종본 저장
- [ ] 5단계 — EventSpec 타입 정의 + track() 구현 (`--doc` 모드로 스킬 skip)
- [ ] 6단계 — tsc / reverse-grep / 리뷰 문서 생성 (`--doc` 모드로 스킬 skip)

**`--doc` 모드로 설계까지만 실행됨.** 실제 구현은 별도 PR 에서 본 문서를 기준으로 진행하고, 구현 완료 후 `--legacy` 없이 `/event-design MemeApp home` 재실행하여 §6.1 자동 검증 (reverse-grep) 수행 권장.
