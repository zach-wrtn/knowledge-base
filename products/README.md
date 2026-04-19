# products/ (Axis 2: Product Specs)

Canonical per-product specs consumed by sprints. One folder per product; each
holds a single current-truth `prd.md` and `events.yaml`.

## Structure

```
products/
  ai-webtoon/    prd.md  events.yaml
  free-tab/      prd.md  events.yaml
  ugc-platform/  prd.md  events.yaml
```

Product directory names MUST match the `product` enum in
`schemas/products/prd.schema.json` and `schemas/products/events.schema.json`.

## Authoring workflow

No write skill exists for axis-2 content (intentional — concurrent writes
haven't been observed). Edit the file with the Write tool, validate locally,
commit directly.

```bash
npm run validate:products   # or the full `npm run validate`
git add products/<product>/<file>
git commit -m "products(<product>): <short description>"
git push
```

## Field rules

### prd.md frontmatter

| field | required | notes |
|---|---|---|
| `product` | yes | must match the containing directory name |
| `status` | yes | `draft` \| `active` \| `archived` |
| `owner` | no | free-form |
| `last_updated` | yes | ISO date (`YYYY-MM-DD`) — update on every edit |
| `related_sprints` | no | array of sprint ids (e.g. `["free-tab-diversification"]`) |
| `schema_version` | yes | `1` for now |

Body is free-form markdown.

### events.yaml

| field | required | notes |
|---|---|---|
| `product` | yes | must match the containing directory name |
| `last_updated` | yes | ISO date |
| `events[].name` | yes | snake_case, starts with lowercase letter |
| `events[].trigger` | yes | ≥5 chars describing when the event fires |
| `events[].properties` | yes | object; values are type/description strings |
| `events[].notes` | no | free-form |
| `schema_version` | yes | `1` for now |

Minimum one event in `events[]`.

## Adding a new product

1. Open a PR that extends the `product` enum in **both** product schemas
2. Create the matching `products/<new-product>/` directory with stub files
3. CODEOWNERS review required (schema PR gate)
