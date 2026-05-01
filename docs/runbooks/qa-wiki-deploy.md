# QA Wiki — Deploy Runbook

End-to-end checklist for taking the team Q&A wiki from "PRs merged, code reviewed" to "live and accepting questions."

**Audience**: zach (project owner) + whoever rotates in for ops.
**One-time cost**: ~45 minutes, mostly waiting for deploys.
**Repo**: `wrtn-tech/zzem-qa-wiki` on github.wrtn.club.

Spec: `docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md`
Plans: `docs/superpowers/plans/2026-04-30-team-qa-wiki-{1,2,3,4}-*.md`

---

## 0. Prerequisites

- [ ] Wiki app PRs merged to `main` (PRs #1, #2, #3 in zzem-qa-wiki)
- [ ] `learning/qa-owners.yaml` exists in `zzem-knowledge-base/main` (already done in Plan 1)
- [ ] You have access to:
  - Firebase Console with permission to create projects + enable Blaze billing
  - GitHub PAT generation (zach's personal account, repo scope)
  - Slack workspace admin for incoming webhook setup
  - The team's Anthropic API key

---

## 1. Firebase Project Setup

In https://console.firebase.google.com:

- [ ] **Add project** → name `zzem-qa-wiki` → disable Google Analytics → create
- [ ] **Authentication** → Sign-in method → Google → enable; under "Authorized domains" leave defaults
- [ ] **Firestore Database** → Create database → location `asia-northeast3 (Seoul)` → Start in production mode
- [ ] **Build → Functions** → enable (this auto-prompts to upgrade to **Blaze plan** — register a card if not already; Cloud Functions and the GitHub fan-out require Blaze)
- [ ] **Hosting** → Get started (you'll use App Hosting later, but enable the umbrella product)
- [ ] **Project Settings (⚙️) → General → Your apps → Add Web App**
  - Nickname: `zzem-qa-wiki-web`
  - Do NOT check "Also set up Firebase Hosting" (we use App Hosting separately)
  - Register
  - Copy the displayed `firebaseConfig` object — you'll paste 6 values in the next step

---

## 2. Local Environment Bootstrap

```bash
cd ~/dev/work/zzem-qa-wiki
cp .env.local.example .env.local
```

Edit `.env.local` and fill in from the `firebaseConfig` you just copied:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=<apiKey>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=zzem-qa-wiki.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=zzem-qa-wiki
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=zzem-qa-wiki.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<senderId>
NEXT_PUBLIC_FIREBASE_APP_ID=<appId>
```

Smoke test:
```bash
npm run dev
```
Open http://localhost:3000 — should redirect to `/login` and show the sign-in card. Click sign-in with a `@wrtn.io` Google account → land on `/`. The other tiles (`/ask`, `/my`, `/queue`, `/search`) work but Cloud Functions return errors until step 4.

---

## 3. Firebase CLI Setup

```bash
cd ~/dev/work/zzem-qa-wiki
npx firebase login                # browser OAuth flow
npx firebase use --add            # pick zzem-qa-wiki, alias 'default' — writes .firebaserc
```

Verify:
```bash
cat .firebaserc
# {"projects":{"default":"zzem-qa-wiki"}}
```

`.firebaserc` is now committed-or-not depending on your team policy — for a single-tenant project with one alias it's safe to commit. (We don't commit it by default.)

---

## 4. Secrets

Five secrets, all stored in Google Secret Manager via `firebase functions:secrets:set` (the SDK reads them at function runtime).

```bash
# Anthropic API key — Claude Sonnet 4.6 + Haiku 4.5 fallback
echo -n "sk-ant-..." | npx firebase functions:secrets:set ANTHROPIC_API_KEY

# GitHub PAT — must have CONTENT WRITE scope on zach-wrtn/knowledge-base
# Create at https://github.com/settings/tokens (fine-grained PAT preferred)
#   Repository access: only zach-wrtn/knowledge-base
#   Permissions: Contents = Read and write
echo -n "github_pat_..." | npx firebase functions:secrets:set GITHUB_TOKEN

# Static — owner/repo for the KB the wiki commits to
echo -n "zach-wrtn"      | npx firebase functions:secrets:set GITHUB_OWNER
echo -n "knowledge-base" | npx firebase functions:secrets:set GITHUB_REPO

# Slack incoming webhook — points at the channel where review notifications post
# Create at https://api.slack.com/apps → New App → Incoming Webhooks → Add to workspace → pick channel
echo -n "https://hooks.slack.com/services/T.../B.../..." | npx firebase functions:secrets:set SLACK_WEBHOOK_URL
```

Verify the keys exist (without exposing values):
```bash
npx firebase functions:secrets:access ANTHROPIC_API_KEY  # should print the value (use sparingly)
```

---

## 5. Deploy

### Firestore (rules + indexes)

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

Expected output: `✔  firestore: released rules`, `✔  firestore: deployed indexes`. Index build takes 1–2 minutes for an empty database; for the queries this app makes (questions by askerUid+updatedAt, qa-records by tokens) you'll see them go from "Building" to "Enabled" in the console.

### Cloud Functions

```bash
cd functions
npm install
npm run build
cd ..
npx firebase deploy --only functions
```

Expected functions deployed:
- `mirrorUserProfile` (auth trigger)
- `generateDraft` (HTTPS callable, 120s timeout, 512 MiB)
- `requestReview` (HTTPS callable, 30s)
- `approveAndCommit` (HTTPS callable, 60s, 512 MiB)
- `rejectDraft` (HTTPS callable, 30s)

All in region `asia-northeast3`. Cold-start the first time you hit each (~3–10s); subsequent calls are warm.

### App Hosting (production deploy)

```bash
npx firebase apphosting:backends:create --location asia-northeast3
```

Walk through prompts:
- Backend name: `zzem-qa-wiki`
- GitHub repository: `wrtn-tech/zzem-qa-wiki` on github.wrtn.club — App Hosting needs to authenticate to GHE; if it can't, fall back to a public mirror or use `firebase deploy --only hosting` with a manual build (see `next.config.ts` rewrites).
- Branch: `main`
- Root directory: `/`
- Region: `asia-northeast3`

After this, every `git push origin main` triggers an automatic build + deploy. The first build takes ~5–8 minutes.

The deployed URL appears in the App Hosting console — typically `https://zzem-qa-wiki--<hash>.<region>.hosted.app` or a custom domain you add later.

---

## 6. Phase 1 Manual Test Checklist

Two `@wrtn.io` Google accounts required: **A** (asker) and **B** (owner). Both must be present in `learning/qa-owners.yaml` for at least one shared scope (or B must be in `admins`).

| Step | Actor | Action | Expected |
|------|-------|--------|----------|
| 1 | A | Sign in → /ask → "When does free-tab end?" / scope=free-tab → Create | Redirected to `/q/{qid}`; question status `drafting`; Firestore: `questions/{qid}` exists |
| 2 | A | /q/{qid} → Generate AI draft | ~5–20s; draft appears with confidence/sources/caveats; Firestore: `drafts/{did}` v1 |
| 3 | A | Edit draft → Save | New draft v2; previous v1 retained (immutable history) |
| 4 | A | Request review | status flips to `review_requested`; Slack message arrives in webhook channel mentioning B's email |
| 5 | B | Sign in → /queue | Sees A's question; opens it |
| 6 | B | Reject with comment "Tighten the scope" | Status flips back to `drafting`; comment shows under question with `rejected` badge for both A and B |
| 7 | A | Edit draft → Request review again | Slack message #2 arrives |
| 8 | B | Approve & commit | Spinner ~5–10s; banner shows `Committed as qa-001 → https://github.com/zach-wrtn/knowledge-base/blob/main/learning/qa/qa-001.md` |
| 9 | — | Open the GitHub URL | File exists; frontmatter has `id: qa-001`, `scope: free-tab`, `asker: A's email`, `approver: B's email`, `approved_at` set, `ai.model`, `ai.sources_used` populated; body has Question + Answer sections |
| 10 | — | KB repo: `npm run validate:learning` | `markdown frontmatter OK`, `qa-owners OK`, `pattern schemas OK` — the new qa-001.md passes the schema validator |
| 11 | A or B | /search → type a keyword from the question | Hit appears with `qa-001` and "view in repo" link |
| 12 | A | /ask → start typing similar question | Similar Q&A suggestion appears under the input within ~350ms |
| 13 | — | Slack channel | Approval message #2 arrives with both "Open in wiki" + "View in repo" buttons |
| 14 | KB consumer | Run `zzem-kb:read type=qa scope=free-tab` from a Claude Code session | Returns the path to `learning/qa/qa-001.md` |

If any step fails, surface it. The most likely failure modes:
- Step 4 Slack failure → check `SLACK_WEBHOOK_URL` secret value
- Step 8 commit failure → check `GITHUB_TOKEN` has `Contents: Write` on the right repo
- Step 8 schema failure → unusual; likely a draft.body that produced unexpected frontmatter (e.g. very long question — 200 char limit). Check `lastApproveError` field on the question doc.
- Step 14 zzem-kb:read miss → confirm the orchestrator session ran `zzem-kb:sync` first

---

## 7. Operational Notes

### Cost tracking

- **Anthropic**: Sonnet 4.6 + adaptive thinking; ≤6 turns per draft; 4096 max_tokens. With 90% cache hit rate on the 3-layer prompt, expect ~$0.03–0.10 per draft. Generate 100 drafts → ~$3–10.
- **Firebase Functions** (Blaze): Each call ~3–10s × 512 MiB. Negligible for human-paced traffic; budget alert at $20/mo.
- **Firestore**: <1KB per question/draft/comment; reads dominate (real-time subscriptions). For team-scale traffic, well within the free tier.
- **App Hosting**: First 750 hours/month free per project; this app fits comfortably.

### Cache hit ratio

Watch in Cloud Logging:
```
filter: jsonPayload.event="generateDraft.complete"
```
After 2–3 generations within 5 minutes, `cacheHitRatio` should be ≥ 0.9. If it stays low:
- Check that `getIndex()` is returning the same string across calls (any non-determinism breaks the cache)
- Check that the system prompt isn't getting a timestamp interpolated

### Adding a new owner / scope

Edit `learning/qa-owners.yaml` in `zzem-knowledge-base`, PR + merge. The Wiki app's `getOwners()` cache is 5 minutes; the new owner is effective within that window without a redeploy.

### Adding a new scope (e.g. `creator-tools`)

Schema-level change. Update:
1. `schemas/learning/qa.schema.json` — add to `scope` enum
2. `schemas/learning/qa-owners.schema.json` — add to `scopes` properties + `required`
3. `learning/qa-owners.yaml` — add the new key
4. `zzem-qa-wiki/src/types/qa.ts` — add to `QAScope` union and `SCOPES` array
5. `zzem-qa-wiki/functions/src/lib/owners.ts` — same
6. `zzem-qa-wiki/functions/src/schemas/qa.schema.json` — re-vendor
7. Redeploy functions
8. Update `firestore.rules` if scope-based authorization is added later

This is intentionally heavy — adding a scope is a real product decision.

### Rotating a secret

```bash
echo -n "<new-value>" | npx firebase functions:secrets:set ANTHROPIC_API_KEY
npx firebase deploy --only functions     # re-deploys with new secret reference
```

### Troubleshooting "review queue is empty for B"

Most common cause: B's email isn't in `learning/qa-owners.yaml` for any scope. Check:
1. The asker's question scope (`q.scope` on Firestore doc)
2. `learning/qa-owners.yaml` — is B's email in `scopes[<that-scope>]` OR in `admins`?
3. Browser cache — `/queue` uses `useOwnedScopes` which has a 5-minute client-side cache; hard reload clears it.

---

## 8. What's NOT in Phase 1

Tracked as Phase 2 / 3 followups (separate plans, not yet written):

- **Stale-check scheduler** — weekly cron that flags `qa-records` past `lastVerifiedAt + staleAfterDays`, DMs the owner. Phase 3.
- **Embedding-based similarity** — replaces token-intersection in `list_related_qa` and `/search`. Phase 2.
- **KB-gap dashboard** — clusters of `confidence: low` Q&A and frequently-asked-but-no-answer topics. Phase 3.
- **Voting on qa-records** — `qa-records/{id}/votes/{uid}` for "still valid" thumbs-up. Phase 2.
- **Comments on drafts (non-blocking owner feedback)** — currently rejection comments only. Phase 2.

When Phase 1 has run for ~4 weeks and you have ≥10 approved Q&A, that's the cue to write the Phase 2 plan.
