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

## ติดตั้งสำหรับทีม BD (dry-run)

ทาง (ข) ชั่วคราว: ผู้ดูแลสร้าง zip ด้วย `WXT_SERVER_URL=https://<server dev> WXT_OAUTH_CLIENT_ID=<id> pnpm --filter extension zip:dev` (ได้ `apps/extension/.output/extension-*-chrome.zip` · ห้าม commit) แล้วแจกให้ BD

1. แตก zip เป็นโฟลเดอร์ (ห้ามลบโฟลเดอร์หลังติดตั้ง)
2. เปิด `chrome://extensions` → เปิด **Developer mode** (มุมขวาบน)
3. กด **Load unpacked** → เลือกโฟลเดอร์ที่แตกไว้
4. กดไอคอนจิ๊กซอว์ → ปักหมุด (pin) Rafael แล้วกดไอคอนเพื่อเปิด Side Panel
5. กด sign-in ด้วยบัญชี Google ที่อยู่ใน test users ของ OAuth client (Chrome ต้อง login profile นั้นอยู่)

ทาง (ก) Web Store แบบ private + force-install ต้องให้ Google Workspace admin เป็นคนทำ

## Layout

| Path | What |
| -- | -- |
| `apps/extension` | Chrome MV3 extension (WXT + React) — side panel |
| `apps/server` | Node + TS server (`/api/health`, later `/ws`) |
| `packages/protocol` | message types shared by both (no React / `chrome.*` / Node imports) |
| `bench/*` | benchmarks (workspace members) |

Node version: `.nvmrc` · contribution flow: [CONTRIBUTING.md](CONTRIBUTING.md)
