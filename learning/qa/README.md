# learning/qa/

Approved Q&A pairs surfaced by the Wiki app (`zzem-qa-wiki`). Filenames are
`qa-{NNN}.md` (zero-padded to at least 3 digits). Each file's frontmatter
matches `schemas/learning/qa.schema.json`.

## Author manually

Direct human edits are allowed for these reasons only:
- Mark `status: deprecated` with a reason
- Mark `status: superseded` with `superseded_by: qa-NNN`
- Bump `last_verified_at` after re-confirming accuracy
- Fix typos / clarify wording in the Answer body

For new content, use the Wiki app's approval flow — do not hand-author new
`qa-NNN.md` files.

## Schema

See `schemas/learning/qa.schema.json`. Validated by
`scripts/validate-markdown-frontmatter.mjs` as part of `npm run validate:learning`.

## Numbering

Numbers are assigned by the Wiki app's `approveAndCommit` Cloud Function
(monotonic, next-available scan). Do not pick numbers manually.
