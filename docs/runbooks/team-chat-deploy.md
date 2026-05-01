# Team Chat — Production Deploy Runbook

**Repo:** `zzem-qa-wiki` (functionally a real-time team chat — repo name kept for stability)
**Spec:** [`../superpowers/specs/2026-05-01-team-chat-design.md`](../superpowers/specs/2026-05-01-team-chat-design.md)
**Region:** `asia-northeast3` (Seoul) for all Cloud Functions

This runbook is the canonical source for setting up and deploying production. Plans 1–5 deliver code; this file delivers the operational layer (Firebase project, secrets, Vertex AI, hosting, monitoring).

---

## 0. Prerequisites

- `gcloud` CLI authenticated as a project owner
- `firebase` CLI ≥ 13 (`npm i -g firebase-tools`)
- Wrtn Google Workspace account with permission to create a Firebase/GCP project under the org
- Anthropic API key (production tier)
- Slack webhook URL for the escalation channel (e.g. `#team-chat-escalations`)

---

## 1. Firebase / GCP project

### 1.1 Create or pick the project

Recommended ID: `wrtn-team-chat` (display name: `wrtn-team-chat`).

```bash
firebase projects:create wrtn-team-chat --display-name "wrtn-team-chat"
gcloud config set project wrtn-team-chat
```

### 1.2 Enable required APIs

```bash
gcloud services enable \
  firebase.googleapis.com \
  firestore.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  identitytoolkit.googleapis.com
```

### 1.3 Provision Firestore (Native mode, region: `asia-northeast3`)

```bash
gcloud firestore databases create --location=asia-northeast3 --type=firestore-native
```

### 1.4 Configure Auth — Google SSO with `@wrtn.io` allowlist

1. Firebase Console → Authentication → Sign-in method → enable Google.
2. Authorized domains: add the production Hosting domain (set in §5).
3. Wrtn-only enforcement is done in `firestore.rules` (see `isWrtn()`); no Auth-side allowlist is configured because Google SSO does not natively support email-domain restriction without Workspace federation.

### 1.5 Create the web app and grab config

```bash
firebase apps:create web zzem-chat-web
firebase apps:sdkconfig WEB <APP_ID> > /tmp/firebase-config.json
```

Copy values into the production `.env.production` (see §5.2).

---

## 2. Cloud Functions — secrets

All 8 secrets live in **Google Secret Manager** and are referenced via `defineSecret()` in `functions/src/lib/secrets.ts`. The deploy step grants the runtime SA access automatically.

| Secret | Used by | How to obtain |
|---|---|---|
| `ANTHROPIC_API_KEY` | `streamMessage`, `shareConversation` | Anthropic Console → API keys |
| `GITHUB_TOKEN` | `streamMessage` (KB tools — read patterns/PRDs) | Fine-grained PAT, read-only on `wrtn-tech/zzem-knowledge-base` |
| `GITHUB_OWNER` | KB tools | `wrtn-tech` |
| `GITHUB_REPO` | KB tools | `zzem-knowledge-base` |
| `SLACK_WEBHOOK_URL` | `escalateToHuman` | Slack app → Incoming Webhooks (target: escalation channel) |
| `WRTN_AI_API_KEY` | `streamMessage`, `shareConversation` (Wrtn provider) | Wrtn AI platform team |
| `WRTN_AI_ENDPOINT` | Wrtn provider | Wrtn AI platform team |
| `VERTEX_LOCATION` | `embeddings.ts`, `searchShared` | `asia-northeast3` (recommended; 768-d index region must match) |

Set each:

```bash
echo -n "sk-ant-..." | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
echo -n "ghp_..."     | gcloud secrets create GITHUB_TOKEN     --data-file=-
echo -n "wrtn-tech"   | gcloud secrets create GITHUB_OWNER     --data-file=-
echo -n "zzem-knowledge-base" | gcloud secrets create GITHUB_REPO --data-file=-
echo -n "https://hooks.slack.com/services/..." | gcloud secrets create SLACK_WEBHOOK_URL --data-file=-
echo -n "<wrtn-key>"     | gcloud secrets create WRTN_AI_API_KEY  --data-file=-
echo -n "<wrtn-url>"     | gcloud secrets create WRTN_AI_ENDPOINT --data-file=-
echo -n "asia-northeast3" | gcloud secrets create VERTEX_LOCATION --data-file=-
```

To rotate later: `gcloud secrets versions add NAME --data-file=-` (Functions pick up new versions on next deploy).

---

## 3. Firestore rules + indexes

```bash
cd ~/dev/work/zzem-qa-wiki
firebase deploy --only firestore:rules --project wrtn-team-chat
firebase deploy --only firestore:indexes --project wrtn-team-chat
```

The indexes file ships **5 indexes**, including 2 vector indexes on `shared-conversations.embedding` (768-d, flat). Index build for empty collections finishes in seconds; for backfills it scales with doc count.

Verify in Firebase Console → Firestore → Indexes; all should report **Enabled**.

---

## 4. Cloud Functions — deploy

```bash
cd ~/dev/work/zzem-qa-wiki/functions
npm ci && npm run build
cd ..
firebase deploy --only functions --project wrtn-team-chat
```

Deployed exports (all in `asia-northeast3`):

| Function | Trigger | Notes |
|---|---|---|
| `mirrorUserProfile` | Auth user create | Mirrors `auth.user` → `users/{uid}` |
| `streamMessage` | HTTPS (SSE) | Long-running; uses ANTHROPIC + WRTN secrets, GitHub KB tools |
| `shareConversation` | Callable | Generates summary/embedding, writes `shared-conversations/{sid}` |
| `searchShared` | Callable | Vertex `findNearest` over `shared-conversations` |
| `escalateToHuman` | Callable | Posts Slack notification + creates `escalations/{eid}` |
| `resolveEscalation` | Callable | Atomically resolves an escalation |

After deploy, capture the `streamMessage` URL — frontend needs it:

```bash
gcloud functions describe streamMessage --region=asia-northeast3 --gen2 --format='value(url)'
```

---

## 5. Hosting

> ⚠️ **Open question — hosting target is unresolved as of 2026-05-01.**
> `firebase.json` rewrites `**` to a Cloud Function named `nextServer`, but
> `functions/src/index.ts` does not export `nextServer`. There are 3 viable
> resolutions; pick one before going live.

### Option A — Firebase App Hosting (recommended, native Next 15 support)

```bash
firebase apphosting:backends:create --project wrtn-team-chat --location asia-northeast3
```

Then connect the GitHub repo via the Firebase Console (App Hosting auto-builds on push to `main`). Remove the `hosting` block from `firebase.json` so the new App Hosting backend takes over.

Pros: zero adapter work, supports Next App Router + SSR + SSE natively.
Cons: App Hosting is GA but limited to a smaller region set; if `asia-northeast3` is unavailable at deploy time, fall back to `asia-east1` and accept ~30ms extra latency.

### Option B — Vercel

`vercel deploy --prod`. Simplest path; requires moving DNS away from Firebase Hosting. The functions still live in Firebase; `NEXT_PUBLIC_STREAM_MESSAGE_URL` points there.

### Option C — Add a `nextServer` function (legacy adapter)

Keeps current `firebase.json` valid. Add a `firebase-frameworks` or `next-on-firebase` adapter export. Maintained adapters are sparse for Next 15; **not recommended** unless the team explicitly wants Firebase Hosting.

### 5.1 Production env vars

Whichever hosting path, set these (App Hosting: via console; Vercel: `vercel env add`):

```
NEXT_PUBLIC_FIREBASE_API_KEY=<from §1.5>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=wrtn-team-chat.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=wrtn-team-chat
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=wrtn-team-chat.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<from §1.5>
NEXT_PUBLIC_FIREBASE_APP_ID=<from §1.5>
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=     # empty for prod
NEXT_PUBLIC_STREAM_MESSAGE_URL=<from §4>
```

---

## 6. Smoke test (production)

After §1–§5 are green:

1. Visit the production URL → redirected to `/login`.
2. Sign in with a `@wrtn.io` Google account.
3. `+ New chat` → `/c/{cid}` should load; type a question; AI response streams via SSE.
4. Open Firestore Console → `conversations/{cid}` exists, `messages/` subcollection populated.
5. From the conversation, click **Share** → `shared-conversations/{sid}` doc appears with 768-d `embedding` array.
6. Visit `/feed` → the just-shared conversation appears.
7. Visit `/search`, type a relevant keyword → vector search returns the shared doc.
8. From a different `@wrtn.io` account, escalate a conversation → Slack channel receives notification; `escalations/{eid}` doc created.
9. Sign out; non-`@wrtn.io` Google account is rejected at the Firestore-rules layer (UI shows permission error).

---

## 7. Monitoring & ops

- **Cloud Functions logs:** Firebase Console → Functions → Logs (filter by region).
- **Streaming errors:** `streamMessage` writes a `messages` doc with `ai.finishReason === "error"` on failure — query that to find broken sessions.
- **Cost watch:**
  - Anthropic spend → Anthropic Console (set monthly cap).
  - Vertex embeddings → ~$0.025 / 1M chars; bursts during share workload.
  - Firestore vector reads → counted as document reads × number-of-candidates; keep `findNearest` `limit ≤ 10`.
- **Rate limits:** `functions/src/lib/rate-limit.ts` enforces per-uid caps in Firestore; logs hit `rate-limits/{uid}`.

---

## 8. Rollback

- **Frontend regression:** `firebase hosting:clone` (Option A/C) or Vercel "Promote previous deployment" (Option B).
- **Functions regression:** redeploy the previous tag — `git checkout <prev-sha> && firebase deploy --only functions`.
- **Bad rules deploy:** `firebase deploy --only firestore:rules` from a known-good revision.
- **Index in build state:** indexes are forward-only; deleting them takes minutes. To roll back schema-incompatible changes, freeze writes (`shareConversation` callable returns disabled), build new index alongside, swap on success.

---

## 9. What's still TODO before first prod traffic

- [ ] §5: pick A/B/C and execute (currently blocking — no hosting target works out-of-box)
- [ ] §1.4: verify Google SSO works end-to-end against the production Hosting domain
- [ ] §3: confirm vector indexes finish building (Console shows "Enabled", not "Building")
- [ ] §6 smoke test, all 9 steps green
- [ ] Set up budget alert (`gcloud billing budgets create ...`) — recommended cap: $200/mo to start

---

## 10. References

- Spec: [`../superpowers/specs/2026-05-01-team-chat-design.md`](../superpowers/specs/2026-05-01-team-chat-design.md)
- Plans: `../superpowers/plans/2026-05-01-team-chat-{1..5}-*.md`
- Firebase project: `wrtn-team-chat` (TBD if not yet created)
- App repo: `wrtn-tech/zzem-qa-wiki`
