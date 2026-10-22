# Contributing — Rafael

งานทุกชิ้นเริ่มจากใบใน Linear (project "Rafael", workspace Praneat) ที่ผูกกับ Story ใน Jira (epic CAR-3817)
กติกาที่ตกลงแล้วอยู่ใน **Decision log — Rafael** ใน Linear (D ล่าสุดชนะ AC) · flow ของ agent อยู่ใน **Graph spec: Rafael**

## Git Flow

| Branch | แตกจาก | merge กลับเข้า | deploy ไป |
| -- | -- | -- | -- |
| `main` | | | production (Cloud Run `rafael`) |
| `develop` (default) | `main` | | env dev (Cloud Run `rafael-dev`) |
| `feature/<CAR-key>-<Linear ID>-<slug>` | `develop` | `develop` | |
| `release/<version>` | `develop` | `main` และ `develop` | |
| `hotfix/<CAR-key>-<slug>` | `main` | `main` และ `develop` | |

### ชื่อ branch
`feature/<Jira key ของ Story>-<Linear ID ของใบย่อย>-<slug>` เช่น `feature/CAR-3819-BE-85-ws-session`
- Jira key → Jira / CodeRabbit ผูก PR กับ Story และดึง AC
- Linear ID → Linear / CodeRabbit ผูก PR กับใบย่อย
- slug สั้น ๆ ภาษาอังกฤษตัวเล็ก คั่นด้วย `-`

### Commit
ขึ้นต้นด้วย Linear ID แล้วตามด้วย type แบบ conventional เช่น `BE-85 feat(server): ws session resume` · `FE-36 fix(extension): ...`

### Merge strategy
- feature → `develop`: **Squash and merge** (1 ใบงาน = 1 commit)
- release / hotfix → `main`: **Create a merge commit** แล้ว tag `vX.Y.Z`
- **คนเป็นคน merge เท่านั้น** — agent ห้าม merge (D5)

## Flow ของ PR (D5)

1. Dev เปิด PR เข้า `develop` เป็น **draft** → ใบใน Linear `In Review`
2. QA ตรวจเทียบ AC → ไม่ผ่าน: ใบกลับ `Todo` · ผ่าน: เปลี่ยน PR เป็น **ready for review** → ใบ `CodeRabbit`
3. CodeRabbit review อัตโนมัติ (ข้าม draft · review ใหม่ทุก push)
   - มีข้อค้าง (ทั้ง thread **และ** Outside diff / Additional comments ใน review body) → ใบกลับ `Todo` ให้ Dev ตอบทุกข้อ (`fixed <sha>` / `wont-fix: เหตุผล + อ้าง D/AC` / `deferred: <ID>`)
   - ไม่มีค้าง → QA สรุปท้าย PR + ลง CodeRabbit decision log → label `ready-to-merge`
4. คน approve + **Squash and merge** → ใบ `Done`
5. Story (parent) ลูกครบ → `In Review` → คนตรวจ AC ทั้ง Story แล้วปิด → Jira `Done`

สั่ง CodeRabbit เองได้ใน comment: `@coderabbitai review` (review commit ใหม่) · `@coderabbitai full review` (ทั้ง PR)

## กฎที่ห้ามพลาด

- **ไม่มีเสียง / transcript / เนื้อหา deal / key ใน repo, log, PR หรือ comment** (D11) — ไฟล์เสียงทดสอบอยู่ใน Drive ภายในเท่านั้น
- **cue ต้องมีที่มาจริงใน Session Pack หรือเป็น `notFound`** (D10)
- secret อยู่ใน Secret Manager เท่านั้น

## ก่อนเปิด PR

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
- เพิ่ม dependency: `pnpm --filter <pkg> add -E <dep>` (pin เวอร์ชันตรง)

## ออก release / hotfix

- release: `release/x.y.z` จาก `develop` → แก้บั๊กเท่านั้น → PR เข้า `main` (merge commit) + tag → PR กลับ `develop`
- hotfix: `hotfix/CAR-xxxx-<slug>` จาก `main` → PR เข้า `main` (merge commit) + tag patch → PR เข้า `develop`
