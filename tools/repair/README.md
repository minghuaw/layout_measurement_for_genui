# repair — one-page repair feedback loop CLI

A stage-based command-line tool for the layout-repair feedback loop:
**analyze → prompt → request → apply → build → gate → measure**.

Pure Node.js ESM. Imports the analyzer's `collectPage`/`loadConfig`/`VIEWPORT` directly
(no shell, no Python, no `curl`). The only subprocess is the `build` stage's
`npx tsc --noEmit && npx vite build`.

No git operations — branches/worktrees/commits/previews are entirely the caller's job.

## Usage

```
node tools/repair/repair.mjs <stage> [flags]
```

### Stages

| stage | flags | output |
|---|---|---|
| `analyze` | `--url --name --out` | `<out>/<name>.report.txt` |
| `prompt` | `--base --prompt-base --whitelist --name --out` | `<out>/<name>.prompt.txt` |
| `request` | `--prompt --name --out [--thinking]` | `.req.json .raw.json .content.txt .usage.json` |
| `apply` | `--content --worktree` | writes `=== FILE:` blocks into the worktree |
| `build` | `--worktree [--build-cmd]` | runs build (default `npx tsc --noEmit && npx vite build`) |
| `gate` | `--base-url --url [--baseline]` | innerText A/B → PASS / DIFF |
| `measure` | `--url --name --out` | `<out>/<name>.report.txt` |
| `run` | `--base-url --url --name --out --worktree --whitelist --prompt-base [--thinking] [--from] [--to] [--dry-run]` | full chain |

### `--thinking`

`off` → `thinking:{type:disabled}`; `low|high|max` → `thinking:{type:enabled}` + `reasoning_effort`.
Default `high`.

### `--whitelist` format

Comma-separated `rel=path` pairs: the `rel` is the label in the `=== FILE:` block,
`path` is the resolvable filesystem path. E.g.

```
--whitelist "src/pages/home/PageView.tsx=../projects/reading-r6low/src/pages/home/PageView.tsx,src/styles/ui/tokens.css=../projects/reading-r6low/src/styles/ui/tokens.css"
```

### Examples

```sh
# analyze only (no API call)
node tools/repair/repair.mjs analyze --url http://localhost:5202/ --name home_base --out cloud/77083299-…/

# send an existing prompt at max effort
node tools/repair/repair.mjs request --prompt cloud/…/home.prompt.txt --name home --out cloud/…/ --thinking max

# content check between base and result previews
node tools/repair/repair.mjs gate --base-url http://localhost:5202/ --url http://localhost:5272/

# full loop at low effort into an existing worktree
node tools/repair/repair.mjs run \
  --base-url http://localhost:5202/ \
  --url http://localhost:5272/ \
  --name home --out cloud/…/ \
  --worktree ../projects/reading-r6low \
  --whitelist "src/pages/home/PageView.tsx=../projects/reading-r6low/src/pages/home/PageView.tsx,src/styles/ui/tokens.css=../projects/reading-r6low/src/styles/ui/tokens.css" \
  --prompt-base cloud/…/prompt_base_v0.txt \
  --thinking low
```

### Partial runs & dry-run

- `--from request --to apply` — start at `request`, stop after `apply`.
- `--dry-run` — stop after `request` (don't apply/build/gate/measure).

## Config

`repair.json` in the cwd or near the tool overrides defaults; CLI flags override the file.

```json
{ "model": "deepseek-v4-flash", "temperature": 0.7, "max_tokens": 65536, "thinking": "high" }
```

API key comes from the `DEEPSEEK_API_KEY` env var.
