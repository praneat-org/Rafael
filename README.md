# Rafael

Live pitch copilot — Chrome extension that listens to a meeting (Meet tab or room mic) and shows short text cues answered **only** from a per-session Google Drive folder.

- Linear: [Rafael](https://linear.app/praneat/project/rafael-4b6cbb757a66) · Jira epic [CAR-3817](https://praneat.atlassian.net/browse/CAR-3817)
- How work flows (agents, QA, CodeRabbit, Jira Sync): Linear doc "Graph spec: Rafael" · run `/tick`, `/tick be`, `/tick fe` in Claude Code
- Decisions: Linear doc "Decision log — Rafael"

## Setup

```sh
corepack enable          # pnpm version comes from package.json
pnpm install
pnpm dev                 # server :8080 + extension (WXT dev) — load apps/extension/.output/chrome-mv3-dev as unpacked
```

Before a PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Layout

| Path | What |
| -- | -- |
| `apps/extension` | Chrome MV3 extension (WXT + React) — side panel |
| `apps/server` | Node + TS server (`/api/health`, later `/ws`) |
| `packages/protocol` | message types shared by both (no React / `chrome.*` / Node imports) |
| `bench/*` | benchmarks (workspace members) |

Node version: `.nvmrc` · contribution flow: [CONTRIBUTING.md](CONTRIBUTING.md)
