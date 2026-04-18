# zzem-knowledge-base

Machine-readable team knowledge base consumed by orchestrator agents.

## Install (consumer)

```bash
# First-time setup
git clone git@github.com:zach-wrtn/knowledge-base.git ~/.zzem/kb
~/.zzem/kb/scripts/install-skills.sh
```

The orchestrator's `scripts/kb-bootstrap.sh` runs both steps idempotently on session start.

Override the clone path with `ZZEM_KB_PATH=/custom/path`.

## Skills (agent interface)

| Skill | Purpose |
|-------|---------|
| `zzem-kb:sync` | Pull latest KB state |
| `zzem-kb:read` | Query by type/category/severity/domain |
| `zzem-kb:write-pattern` | Create a new defect pattern |
| `zzem-kb:update-pattern` | Bump frequency / last_seen of an existing pattern |
| `zzem-kb:write-reflection` | Record a sprint retrospective |

Each skill's `SKILL.md` is the authoritative protocol; agents invoke them via the Skill tool.

## Content types

| Type | Directory | Schema | Filename |
|------|-----------|--------|----------|
| pattern | `content/patterns/` | `schemas/pattern.schema.json` | `{category}-{NNN}.yaml` |
| rubric | `content/rubrics/` | `schemas/rubric.schema.json` | `v{N}.md` |
| reflection | `content/reflections/` | `schemas/reflection.schema.json` | `{sprint-id}.md` |

## Contributing

- **Content (`content/**`):** direct push to `main` permitted (CI validates schemas).
- **Everything else:** PR required; CODEOWNERS review enforced by repository ruleset.

Breaking schema changes follow the procedure in the Phase 1 design doc `docs/superpowers/specs/2026-04-18-knowledge-base-platform-phase1-design.md` in the orchestrator repo.

## Development

```bash
npm install
npm run validate   # run all validators locally
```

## License

Public — zach-wrtn team knowledge base.
