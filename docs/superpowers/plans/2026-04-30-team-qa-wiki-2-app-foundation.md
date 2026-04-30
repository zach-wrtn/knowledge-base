# Team Q&A Wiki — Plan 2: Wiki App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `zzem-qa-wiki` web app with Next.js 15 + Firebase Auth/Firestore/Hosting/Functions, restricted to `@wrtn.io`, and ship the question-creation UI (no AI draft yet — that's Plan 3).

**Architecture:** Next.js 15 App Router (TypeScript) + Tailwind + shadcn/ui on Firebase Hosting. Firebase Auth (Google SSO, domain restricted) for identity. Firestore for live state with security rules pinned to `@wrtn.io` and document-ownership invariants. Cloud Functions (TypeScript, gen2) scaffolded but only auth-trigger `mirrorUserProfile` ships in this plan.

**Tech Stack:** Node.js 20, Next.js 15.x, Firebase JS SDK v10, Firebase Admin SDK, Cloud Functions for Firebase v6 (gen2), Tailwind v3, shadcn/ui, Playwright for E2E.

**Spec:** `zzem-knowledge-base/docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md` §1, §2 (Firestore section), §3 (drafting state only — review/approve in Plan 4).

**Prerequisite:** Plan 1 merged (the new app does not block on it for this plan, but Plan 4 will require qa-owners.yaml).

---

## File Structure (relative to new repo `zzem-qa-wiki/`)

**Create — root scaffolding:**
- `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.eslintrc.json`, `.prettierrc`
- `tailwind.config.ts`, `postcss.config.mjs`, `components.json` (shadcn config)
- `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`
- `.env.local.example`
- `README.md`

**Create — Next.js app:**
- `src/app/layout.tsx` — root layout with auth provider
- `src/app/page.tsx` — landing/dashboard (redirects based on auth state)
- `src/app/login/page.tsx` — Google SSO sign-in
- `src/app/ask/page.tsx` — question creation form (no AI in this plan)
- `src/app/my/page.tsx` — list of the current user's questions
- `src/app/q/[qid]/page.tsx` — question detail (read-only stub for this plan)
- `src/app/api/health/route.ts` — health check

**Create — Firebase glue:**
- `src/lib/firebase/client.ts` — browser-side Firebase init
- `src/lib/firebase/admin.ts` — server-side Admin SDK init (App Hosting / Functions)
- `src/lib/firebase/auth-provider.tsx` — React context for auth state
- `src/lib/firebase/db.ts` — Firestore typed helpers

**Create — types:**
- `src/types/qa.ts` — TypeScript types matching spec §2

**Create — UI primitives (shadcn-generated):**
- `src/components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `card.tsx`, `toast.tsx`

**Create — Cloud Functions:**
- `functions/package.json`, `functions/tsconfig.json`, `functions/src/index.ts`
- `functions/src/auth/mirrorUserProfile.ts`

**Create — tests:**
- `tests/e2e/login.spec.ts`
- `tests/e2e/ask.spec.ts`
- `tests/security/firestore-rules.test.ts`
- `playwright.config.ts`

---

### Task 1: Bootstrap repo

**Files:** none yet

- [ ] **Step 1: Create the GitHub repo (manual)**

Create `zach-wrtn/zzem-qa-wiki` on GitHub. Empty (no README/license/gitignore from GitHub — we generate ours).

- [ ] **Step 2: Clone locally**

```bash
cd ~/dev/work
git clone git@github.com:zach-wrtn/zzem-qa-wiki.git
cd zzem-qa-wiki
```

- [ ] **Step 3: Initialize Next.js**

```bash
npx create-next-app@15 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

When prompted for an existing-directory conflict, accept overwrite. Verify the resulting directory contains `src/app/`, `tailwind.config.ts`, `tsconfig.json`.

- [ ] **Step 4: Install runtime deps**

```bash
npm install firebase firebase-admin zod
npm install -D @playwright/test firebase-tools @types/node
```

- [ ] **Step 5: Add `.gitignore` lines**

Append to `.gitignore`:
```
.env.local
.firebase/
firebase-debug.log
.DS_Store
playwright-report/
test-results/
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "init: next.js 15 scaffold with firebase + playwright deps"
```

---

### Task 2: Set up Firebase project

**Files:**
- Create: `.firebaserc`
- Create: `firebase.json`
- Create: `firestore.rules`
- Create: `firestore.indexes.json`
- Create: `.env.local.example`

- [ ] **Step 1: Create Firebase project**

In a browser: console.firebase.google.com → New project `zzem-qa-wiki`. Disable Google Analytics (not needed). Enable: Authentication (Google provider), Firestore, Hosting, Functions, Storage (off — unused).

- [ ] **Step 2: Configure auth domain restriction**

Authentication → Settings → Authorized domains: keep default. Sign-in method → Google → Enable. The `@wrtn.io` enforcement is done in client + security rules, not in the Auth provider config (Google supports any account).

- [ ] **Step 3: Login firebase-tools**

```bash
npx firebase login
npx firebase use --add
```

Select the `zzem-qa-wiki` project, alias `default`.

- [ ] **Step 4: Write `firebase.json`**

```json
{
  "hosting": {
    "public": ".next",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "function": "nextServer" }]
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs20",
      "ignore": ["node_modules", "*.local"]
    }
  ],
  "emulators": {
    "auth":      { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "hosting":   { "port": 5000 },
    "ui":        { "enabled": true, "port": 4000 }
  }
}
```

- [ ] **Step 5: Write `firestore.indexes.json`**

```json
{
  "indexes": [
    {
      "collectionGroup": "questions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "askerUid", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "questions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "scope", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 6: Write `firestore.rules` (initial — Plan 4 tightens further)**

`firestore.rules`:
```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isWrtn() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.matches(".*@wrtn[.]io$");
    }
    function isOwner(uid) { return isWrtn() && request.auth.uid == uid; }
    function noStatusJump(allowed) {
      return !("status" in request.resource.data)
        || request.resource.data.status in allowed;
    }

    match /users/{uid} {
      allow read:  if isWrtn();
      allow write: if false; // mirrorUserProfile (auth trigger) only
    }

    match /questions/{qid} {
      // any wrtn member can read
      allow read: if isWrtn();

      // create: only as oneself; status must start at 'drafting'
      allow create: if isWrtn()
        && request.resource.data.askerUid == request.auth.uid
        && request.resource.data.status == 'drafting';

      // update: only the asker, and only into drafting/review_requested/rejected.
      // 'approved' transitions are gated to Cloud Function via custom claim or
      // backend-only writes (Plan 4 will enforce; for now block client approval).
      allow update: if isOwner(resource.data.askerUid)
        && noStatusJump(['drafting', 'review_requested', 'rejected', 'archived'])
        && resource.data.status != 'approved';

      allow delete: if false;

      match /drafts/{did} {
        allow read:  if isWrtn();
        allow create: if isOwner(get(/databases/$(database)/documents/questions/$(qid)).data.askerUid);
        allow update, delete: if false; // drafts immutable
      }

      match /comments/{cid} {
        allow read:   if isWrtn();
        allow create: if isWrtn()
          && request.resource.data.authorUid == request.auth.uid;
        allow update, delete: if isOwner(resource.data.authorUid);
      }
    }

    match /qa-records/{qid} {
      allow read:  if isWrtn();
      allow write: if false; // Cloud Function only
    }

    match /notifications/{nid} {
      allow read:  if isOwner(resource.data.toUid);
      allow update: if isOwner(resource.data.toUid)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readAt']);
      allow create, delete: if false;
    }
  }
}
```

- [ ] **Step 7: Write `.env.local.example`**

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=zzem-qa-wiki.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=zzem-qa-wiki
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=zzem-qa-wiki.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Copy to `.env.local`, fill from Firebase Console → Project Settings → General → Your apps → Web app config.

- [ ] **Step 8: Deploy rules + indexes**

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

- [ ] **Step 9: Commit**

```bash
git add firebase.json firestore.rules firestore.indexes.json .env.local.example .firebaserc
git commit -m "firebase: project config, security rules, indexes"
```

---

### Task 3: Tailwind + shadcn/ui

**Files:**
- Modify: `src/app/globals.css`
- Create: `components.json`
- Create: `src/components/ui/{button,input,textarea,select,card,toast}.tsx`

- [ ] **Step 1: Initialize shadcn**

```bash
npx shadcn@latest init
```

Pick: TypeScript yes, Default style, Slate base color, CSS variables yes, `app/globals.css`, `tailwind.config.ts`, `@/components/ui` alias, `@/lib/utils` alias. React Server Components yes.

- [ ] **Step 2: Add the UI primitives**

```bash
npx shadcn@latest add button input textarea select card toast
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ui: tailwind + shadcn primitives (button/input/textarea/select/card/toast)"
```

---

### Task 4: Firebase client + auth provider

**Files:**
- Create: `src/lib/firebase/client.ts`
- Create: `src/lib/firebase/auth-provider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Write client.ts**

`src/lib/firebase/client.ts`:
```ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

let app: FirebaseApp;
export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!getApps().length) app = initializeApp(config);
  else app = getApps()[0]!;
  return { app, auth: getAuth(app), db: getFirestore(app) };
}
```

- [ ] **Step 2: Write auth provider with @wrtn.io enforcement**

`src/lib/firebase/auth-provider.tsx`:
```tsx
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { getFirebase } from "./client";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOutNow: () => Promise<void>;
  domainError: string | null;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { auth } = getFirebase();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [domainError, setDomainError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u && !u.email?.endsWith("@wrtn.io")) {
        await signOut(auth);
        setUser(null);
        setDomainError("Only @wrtn.io accounts are allowed.");
      } else {
        setDomainError(null);
        setUser(u);
      }
      setLoading(false);
    });
  }, [auth]);

  async function signIn() {
    setDomainError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: "wrtn.io" }); // Google-side hint, not enforcement
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async function signOutNow() { await signOut(auth); }

  return (
    <Ctx.Provider value={{ user, loading, signIn, signOutNow, domainError }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
```

- [ ] **Step 3: Wire AuthProvider into root layout**

Replace `src/app/layout.tsx` with:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/firebase/auth-provider";

export const metadata: Metadata = {
  title: "zzem QA Wiki",
  description: "Team Q&A wiki for wrtn",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/firebase src/app/layout.tsx
git commit -m "auth: firebase google sso provider with @wrtn.io enforcement"
```

---

### Task 5: Login + landing pages

**Files:**
- Replace: `src/app/page.tsx`
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Write login page**

`src/app/login/page.tsx`:
```tsx
"use client";
import { useAuth } from "@/lib/firebase/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const { user, loading, signIn, domainError } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>zzem QA Wiki</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sign in with your <span className="font-mono">@wrtn.io</span> Google account.
          </p>
          {domainError && (
            <p role="alert" className="text-sm text-destructive">{domainError}</p>
          )}
          <Button onClick={signIn} disabled={loading} className="w-full">
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Replace landing page**

`src/app/page.tsx`:
```tsx
"use client";
import { useAuth } from "@/lib/firebase/auth-provider";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const { user, loading, signOutNow } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">zzem QA Wiki</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user.email}</span>
          <Button variant="ghost" onClick={signOutNow}>Sign out</Button>
        </div>
      </header>
      <section className="mt-10 grid grid-cols-2 gap-4">
        <Link href="/ask" className="rounded-lg border p-6 hover:bg-accent">
          <div className="text-lg font-medium">Ask a question</div>
          <div className="text-sm text-muted-foreground">Start a new Q&A entry</div>
        </Link>
        <Link href="/my" className="rounded-lg border p-6 hover:bg-accent">
          <div className="text-lg font-medium">My questions</div>
          <div className="text-sm text-muted-foreground">Drafts and approved answers</div>
        </Link>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Run dev server, hand-verify**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: redirects to `/login`. Sign in with a non-`@wrtn.io` Google account → bounced with domain error. Sign in with `@wrtn.io` → lands on home.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/login/page.tsx
git commit -m "ui: login page + authed landing"
```

---

### Task 6: TypeScript types matching Firestore spec

**Files:**
- Create: `src/types/qa.ts`

- [ ] **Step 1: Write types**

`src/types/qa.ts`:
```ts
import type { Timestamp } from "firebase/firestore";

export type QAScope = "global" | "ai-webtoon" | "free-tab" | "ugc-platform";

export type QuestionStatus =
  | "drafting"
  | "review_requested"
  | "approved"
  | "rejected"
  | "archived";

export interface QuestionDoc {
  text: string;
  body?: string;
  scope: QAScope;
  askerUid: string;
  status: QuestionStatus;
  currentDraftId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  approvedQaId?: string;
}

export type AISourceType = "pattern" | "prd" | "event" | "qa" | "reflection" | "rubric";

export interface AISource {
  type: AISourceType;
  id: string;
  excerpt?: string;
  why?: string;
}

export interface DraftDoc {
  body: string;
  editorUid: string;
  version: number;
  ai: {
    model: string;
    sourcesUsed: AISource[];
    confidence: "high" | "medium" | "low";
    caveats: string[];
    tokenUsage: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
    draftedAt: Timestamp;
  };
}

export interface CommentDoc {
  body: string;
  authorUid: string;
  createdAt: Timestamp;
}

export interface QARecordDoc {
  scope: QAScope;
  ownerUids: string[];
  voteCount: number;
  lastVerifiedAt: Timestamp;
  staleAfterDays: number;
}

export interface NotificationDoc {
  toUid: string;
  type: "review_requested" | "approved" | "rejected" | "stale" | "broadcast";
  payload: Record<string, unknown>;
  sentAt: Timestamp;
  readAt?: Timestamp;
  failedAt?: Timestamp;
}

export interface UserDoc {
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: Timestamp;
}

export const SCOPES: QAScope[] = ["global", "ai-webtoon", "free-tab", "ugc-platform"];
```

- [ ] **Step 2: Build to confirm**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/qa.ts
git commit -m "types: firestore data model for questions/drafts/comments/etc."
```

---

### Task 7: Ask-a-question form (no AI)

**Files:**
- Create: `src/lib/firebase/db.ts`
- Create: `src/app/ask/page.tsx`

- [ ] **Step 1: Write db helper**

`src/lib/firebase/db.ts`:
```ts
import {
  addDoc, collection, doc, serverTimestamp, query,
  where, orderBy, limit, getDocs,
} from "firebase/firestore";
import { getFirebase } from "./client";
import type { QAScope, QuestionDoc } from "@/types/qa";

export async function createQuestion(input: {
  text: string;
  body?: string;
  scope: QAScope;
  askerUid: string;
}) {
  const { db } = getFirebase();
  const ref = await addDoc(collection(db, "questions"), {
    text:      input.text,
    body:      input.body ?? "",
    scope:     input.scope,
    askerUid:  input.askerUid,
    status:    "drafting",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listMyQuestions(uid: string) {
  const { db } = getFirebase();
  const q = query(
    collection(db, "questions"),
    where("askerUid", "==", uid),
    orderBy("updatedAt", "desc"),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as QuestionDoc) }));
}

export function questionRef(qid: string) {
  const { db } = getFirebase();
  return doc(db, "questions", qid);
}
```

- [ ] **Step 2: Write ask page**

`src/app/ask/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { createQuestion } from "@/lib/firebase/db";
import { SCOPES, type QAScope } from "@/types/qa";

export default function AskPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<QAScope>("global");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (text.trim().length < 5) { setErr("Question must be at least 5 characters."); return; }
    setBusy(true);
    setErr(null);
    try {
      const qid = await createQuestion({ text: text.trim(), body: body.trim(), scope, askerUid: user.uid });
      router.push(`/q/${qid}`);
    } catch (e) {
      console.error(e);
      setErr("Failed to create question. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader><CardTitle>Ask a question</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Question</label>
              <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={200}
                placeholder="One-line question (max 200 chars)" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Details (optional)</label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
                placeholder="Context, what you've already tried, links..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Scope</label>
              <Select value={scope} onValueChange={(v) => setScope(v as QAScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create question"}</Button>
              <Button type="button" variant="ghost" onClick={() => router.push("/")}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Hand-verify**

```bash
npm run dev
```

Sign in → `/ask` → fill out → submit. Expected: redirected to `/q/{qid}` (page doesn't exist yet — 404 OK for this step). Open Firestore console: `questions/{qid}` exists with status `drafting`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/firebase/db.ts src/app/ask/page.tsx
git commit -m "ui: ask-a-question form (no AI yet, status=drafting)"
```

---

### Task 8: Question detail stub

**Files:**
- Create: `src/app/q/[qid]/page.tsx`

- [ ] **Step 1: Write read-only stub**

`src/app/q/[qid]/page.tsx`:
```tsx
"use client";
import { useAuth } from "@/lib/firebase/auth-provider";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import type { QuestionDoc } from "@/types/qa";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { use } from "react";

export default function QuestionPage({ params }: { params: Promise<{ qid: string }> }) {
  const { qid } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState<(QuestionDoc & { id: string }) | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    return onSnapshot(doc(db, "questions", qid), (s) => {
      setQ(s.exists() ? ({ id: s.id, ...(s.data() as QuestionDoc) }) : null);
    });
  }, [user, qid]);

  if (loading || !user) return null;
  if (!q) return <main className="p-6">Loading…</main>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>{q.text}</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            scope: <span className="font-mono">{q.scope}</span> · status: <span className="font-mono">{q.status}</span>
          </div>
        </CardHeader>
        <CardContent>
          {q.body && <p className="whitespace-pre-wrap text-sm">{q.body}</p>}
          <p className="mt-6 text-sm text-muted-foreground">
            AI draft generation lands in Plan 3. For now this page just shows the question record.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Hand-verify**

Visit `/q/{qid}` from the previous task. Expected: question text/body/scope/status visible. Status shows `drafting`.

- [ ] **Step 3: Commit**

```bash
git add src/app/q
git commit -m "ui: question detail stub (read-only)"
```

---

### Task 9: My-questions list

**Files:**
- Create: `src/app/my/page.tsx`

- [ ] **Step 1: Write list page**

`src/app/my/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-provider";
import { listMyQuestions } from "@/lib/firebase/db";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QuestionDoc } from "@/types/qa";

export default function MyPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<(QuestionDoc & { id: string })[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    listMyQuestions(user.uid).then((rows) => {
      setItems(rows);
      setBusy(false);
    });
  }, [user]);

  if (loading || !user) return null;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-3">
      <h1 className="text-2xl font-semibold">My questions</h1>
      {busy && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!busy && items.length === 0 && <p className="text-sm text-muted-foreground">No questions yet.</p>}
      {items.map((q) => (
        <Link key={q.id} href={`/q/${q.id}`}>
          <Card className="hover:bg-accent">
            <CardContent className="py-4">
              <div className="font-medium">{q.text}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                scope: <span className="font-mono">{q.scope}</span> · status: <span className="font-mono">{q.status}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Hand-verify**

Sign in → ask 2 questions → visit `/my`. Expected: both visible, latest first.

- [ ] **Step 3: Commit**

```bash
git add src/app/my
git commit -m "ui: my-questions list page"
```

---

### Task 10: mirrorUserProfile Cloud Function

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`
- Create: `functions/src/index.ts`
- Create: `functions/src/auth/mirrorUserProfile.ts`

- [ ] **Step 1: Init functions package**

```bash
mkdir -p functions/src/auth
```

`functions/package.json`:
```json
{
  "name": "zzem-qa-wiki-functions",
  "version": "0.0.1",
  "scripts": {
    "build": "tsc",
    "serve": "npm run build && firebase emulators:start --only functions",
    "deploy": "firebase deploy --only functions"
  },
  "engines": { "node": "20" },
  "main": "lib/index.js",
  "dependencies": {
    "firebase-admin": "^12.6.0",
    "firebase-functions": "^6.1.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  },
  "private": true
}
```

`functions/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es2022",
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noImplicitReturns": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Install function deps**

```bash
cd functions && npm install && cd ..
```

- [ ] **Step 3: Write mirrorUserProfile**

`functions/src/auth/mirrorUserProfile.ts`:
```ts
import { auth } from "firebase-functions/v2";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

export const mirrorUserProfile = auth.user().onCreate(async (user) => {
  if (!user.email?.endsWith("@wrtn.io")) {
    // Defense-in-depth — block non-wrtn accounts even if domain hint was bypassed.
    await admin.auth().deleteUser(user.uid);
    return;
  }
  await admin.firestore().doc(`users/${user.uid}`).set({
    email: user.email,
    displayName: user.displayName ?? user.email,
    avatarUrl: user.photoURL ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
```

Note: `firebase-functions/v2` does not yet expose `auth.user().onCreate` in all releases. If you're on a v6.x where the v1 trigger is the supported path for blocking auth, replace with:

```ts
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

export const mirrorUserProfile = functions.auth.user().onCreate(async (user) => {
  if (!user.email?.endsWith("@wrtn.io")) {
    await admin.auth().deleteUser(user.uid);
    return;
  }
  await admin.firestore().doc(`users/${user.uid}`).set({
    email: user.email,
    displayName: user.displayName ?? user.email,
    avatarUrl: user.photoURL ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
```

Use whichever is supported in your installed `firebase-functions` version. The v1 import is stable today.

- [ ] **Step 4: Wire entry point**

`functions/src/index.ts`:
```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
```

- [ ] **Step 5: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 6: Deploy**

```bash
npx firebase deploy --only functions:mirrorUserProfile
```

- [ ] **Step 7: Hand-verify**

Sign in with a fresh `@wrtn.io` account. Check Firestore: `users/{uid}` exists with email/displayName.

- [ ] **Step 8: Commit**

```bash
git add functions
git commit -m "functions: mirrorUserProfile auth trigger (caches user doc)"
```

---

### Task 11: Playwright E2E for login + ask

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/login.spec.ts`
- Create: `tests/e2e/ask.spec.ts`

- [ ] **Step 1: Install browsers**

```bash
npx playwright install chromium
```

- [ ] **Step 2: Write playwright config**

`playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
```

- [ ] **Step 3: Write login flow**

E2E for Google SSO is non-trivial; instead test the *unauthenticated* gate behavior, which is the high-value contract here.

`tests/e2e/login.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("redirects unauthenticated user to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("zzem QA Wiki")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in with google/i })).toBeVisible();
});

test("login page shows @wrtn.io requirement", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText(/@wrtn\.io/)).toBeVisible();
});
```

- [ ] **Step 4: Write ask flow against the auth emulator**

True end-to-end against production Auth requires a real Google account. For CI, we use the Firebase Auth emulator — simpler. For now, gate the ask test behind `E2E_AUTH_EMULATOR=1` so it can be skipped locally without setup.

`tests/e2e/ask.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

const useEmulator = process.env.E2E_AUTH_EMULATOR === "1";

test.describe("ask flow", () => {
  test.skip(!useEmulator, "Requires E2E_AUTH_EMULATOR=1 + emulator running");

  test("authed user can create a question", async ({ page }) => {
    // Pre-set emulator auth via REST (skipped here for brevity — see emulator docs)
    await page.goto("/ask");
    await page.getByLabel(/question/i).fill("How do we route ai-webtoon Q&A?");
    await page.getByLabel(/details/i).fill("Looking for the owner.");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "ai-webtoon" }).click();
    await page.getByRole("button", { name: /create question/i }).click();
    await expect(page).toHaveURL(/\/q\//);
    await expect(page.getByText("How do we route ai-webtoon Q&A?")).toBeVisible();
    await expect(page.getByText("status:")).toContainText("drafting");
  });
});
```

- [ ] **Step 5: Run unauth tests**

```bash
npx playwright test tests/e2e/login.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Add npm script**

In `package.json` `"scripts"`, add:
```json
"e2e": "playwright test"
```

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts tests/e2e package.json
git commit -m "test: playwright e2e for unauth gate; ask flow gated on emulator"
```

---

### Task 12: Health endpoint + deploy

**Files:**
- Create: `src/app/api/health/route.ts`

- [ ] **Step 1: Write health route**

`src/app/api/health/route.ts`:
```ts
import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({ status: "ok", ts: Date.now() });
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Decide hosting flavor**

Firebase Hosting + Cloud Functions for Next.js SSR is workable but complex. For Phase 1, two options:

1. **Static export** — simpler, but loses Server Components / Server Actions. Not a fit (we need them in Plan 4).
2. **Firebase App Hosting** — preview product but supports Next.js 15 App Router natively. Recommended.

Use App Hosting:

```bash
npx firebase apphosting:backends:create --location asia-northeast3
```

Follow prompts: connect GitHub repo, branch `main`. Subsequent pushes deploy automatically.

- [ ] **Step 4: Push to GitHub and verify deploy**

```bash
git push -u origin main
```

Watch App Hosting console for build → deploy. Open the deployed URL → expects `/login` redirect.

- [ ] **Step 5: Smoke check health**

```bash
curl https://<deployed-host>/api/health
```

Expected: `{"status":"ok","ts":...}`.

- [ ] **Step 6: Commit deploy notes**

`README.md` (in `zzem-qa-wiki/`):
```markdown
# zzem-qa-wiki

Internal team Q&A wiki. AI-drafted answers grounded in `zzem-knowledge-base`,
human-approved, committed back to that repo as `learning/qa/qa-{NNN}.md`.

## Stack
Next.js 15 + Firebase Hosting (App Hosting) + Firestore + Cloud Functions.
Sonnet 4.6 via Anthropic SDK with prompt caching (Plan 3).

## Local dev
```bash
cp .env.local.example .env.local   # fill from Firebase Console
npm install
npm run dev
```

## E2E
```bash
npx playwright test
```
For the authenticated ask flow:
```bash
firebase emulators:start --only auth,firestore
E2E_AUTH_EMULATOR=1 npx playwright test
```

## Spec & plan
Spec: `zzem-knowledge-base/docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md`
Plans: `zzem-knowledge-base/docs/superpowers/plans/2026-04-30-team-qa-wiki-*.md`
```

```bash
git add README.md
git commit -m "docs: project README"
git push
```

---

## Self-review notes

- **Spec coverage:** §1 architecture (Next.js + Firebase Hosting + Firestore + Functions ✓), §2 Firestore data model (questions/drafts/comments/qa-records/notifications/users ✓), §2 security rules core (`@wrtn.io` ✓, asker-only writes ✓, approved-status gated to backend ✓), §3 drafting state ✓ (review/approve in Plan 4). AI integration deferred to Plan 3.
- **Out of scope flags:** `qa-records` writes, `approveAndCommit` rule path, Slack notifications, owner queue, search — all in Plan 4. The current `firestore.rules` block client `approved` writes outright; Plan 4 introduces a stricter rule (custom claim or backend-only) that maintains this invariant.
- **Auth emulator gating** in Task 11 keeps CI deterministic without forcing Google account setup. The ask spec runs only when `E2E_AUTH_EMULATOR=1` — Plan 4 expands this once the full pipeline is testable.
- **App Hosting** is the recommended deploy target. If the team prefers a separate Vercel deployment with Firestore-only backend, Task 12 swaps. Either is compatible with Plans 3/4.
- **`hd: "wrtn.io"`** in the Google provider is a hint; real enforcement is the post-sign-in domain check + `mirrorUserProfile`'s deletion of non-wrtn accounts + Firestore rules. Defense in depth.
