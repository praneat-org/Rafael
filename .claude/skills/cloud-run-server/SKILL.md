---
name: cloud-run-server
description: วิธีเขียน apps/server ของ Rafael บน Cloud Run (asia-southeast1) — WebSocket /ws, timeout / session affinity / heartbeat, SessionStore ใน memory + resumeToken, ตรวจ Google access token ฝั่ง server, เช็ก Origin ของ extension, secret จาก Secret Manager, logger ที่ redact เนื้อหา และวิธีทดสอบ ใช้ทุกครั้งที่แตะ apps/server, packages/protocol, cloudbuild*.yaml หรือ Dockerfile
---

# Cloud Run server — Rafael

Node LTS · TypeScript strict · WebSocket ด้วย `ws` · message ทุกชนิด validate ด้วย zod จาก `packages/protocol`

## โครงไฟล์
```
apps/server/src/
  index.ts     # HTTP server (/healthz) + upgrade /ws · อ่าน PORT จาก env (default 8080)
  ws/          # upgrade, Origin check, heartbeat, parse message / binary frame
  session/     # SessionStore (in-memory, TTL, resumeToken)
  auth/        # ตรวจ Google access token
  source/      # อ่าน Session Pack จาก Drive ด้วย token ของผู้ใช้ → index [file › page]
  stt/         # adapter Chirp 3 / Deepgram (interface เดียว)
  brain/       # Detector + Answerer — ดู skill cue-brain
  eval/        # golden set + script วัดผล
```

## Cloud Run
- deploy ผ่าน `cloudbuild*.yaml` · region `asia-southeast1` · `--timeout=3600` (สูงสุด) → WebSocket ถูกตัดที่ 60 นาทีเสมอ client ต้อง reconnect + resume
- `--session-affinity` (best effort — ไม่รับประกัน) · instance ถูก scale-in / redeploy ได้ → session ใน memory หาย → resume ไม่เจอ → ตอบ error code ให้ client เริ่ม session ใหม่ ไม่ crash
- SIGTERM → ปิดทุก socket ด้วย close code ที่ protocol กำหนด (client รู้ว่าให้ reconnect) ภายใน 10 วิ
- secret (LLM / STT key ถ้ามี, OAuth client id ที่ใช้เทียบ) ผ่าน `--set-secrets` จาก Secret Manager → อ่านจาก `process.env` เท่านั้น · ห้ามอยู่ใน `cloudbuild*.yaml` / Dockerfile / repo
- Dockerfile: multi-stage, `pnpm deploy --prod`, รันด้วย user ไม่ใช่ root

## WebSocket `/ws`
- ตอน upgrade: `Origin` ต้องเป็น `chrome-extension://<EXTENSION_ID>` (จาก env, dev อนุญาต localhost เพิ่มได้) ไม่ตรง → 403 ก่อน upgrade
- message แรกต้องเป็น `hello` (มี access token, protocol version, resumeToken ถ้ามี) ภายใน ~5 วิ ไม่งั้นปิด · ก่อน auth ผ่านไม่รับ audio frame
- heartbeat: `ws.ping()` ทุก 25 วิ · ไม่ได้ pong ในรอบถัดไป → `terminate()` (Cloud Run / proxy ตัด socket ที่เงียบ)
- binary frame = เสียง PCM16 16 kHz mono 100 ms ตาม `packages/protocol` · text frame = JSON control → `safeParse` ไม่ผ่าน → ตอบ error code ไม่ส่ง stack
- backpressure: `ws.bufferedAmount` สูง → ทิ้ง partial cue เก่า ส่งตัวล่าสุด

## Auth (`auth/`)
- ตรวจ token ฝั่ง server ทุกครั้งที่ `hello`: `https://oauth2.googleapis.com/tokeninfo?access_token=…` → `aud`/`azp` ต้องตรง OAuth client ของ extension, `email_verified === 'true'`, email ลงท้าย `@praneat.com`, `expires_in` > 0 · (หรือ userinfo `https://openidconnect.googleapis.com/v1/userinfo` ถ้าต้องการ profile — แต่ userinfo ไม่บอก `aud` ต้องใช้ tokeninfo คู่)
- cache ผลตรวจใน memory ตาม hash ของ token ไม่เกิน `expires_in` · ไม่ log token
- token ใช้ต่ออ่าน Drive (`drive.readonly`) ใน memory ของ session เท่านั้น

## SessionStore (`session/`)
- `Map<sessionId, Session>` ใน memory · TTL 24 ชม. นับจาก activity ล่าสุด · sweep ด้วย `setInterval(...).unref()`
- `resumeToken` = random 32 byte (`crypto.randomBytes`) ผูกกับ sessionId + email · resume ต้องตรงทั้ง token และ email ที่ auth ผ่านรอบนี้
- ใน session: pack index, ประวัติคำถาม (dedupe), สถานะ STT stream — **ไม่มีอะไรลง disk / bucket / DB** (D11)

## Logger
- structured JSON (pino) ลง stdout → Cloud Logging
- `redact` ทุก path ที่อาจมีเนื้อหา: `text`, `bullets`, `question`, `transcript`, `pack`, `pcm`, `audio`, `token`, `accessToken`, `resumeToken`, `authorization`, `*.text`, `*.bullets`, `*.question` …
- log ได้: sessionId, email hash, ขนาด, จำนวน, latency, model id, usage, error code
- อย่า log `err` ดิบจาก SDK ของ provider โดยไม่กรอง — บาง error แนบ request body

## ทดสอบ
- unit (vitest): auth (mock fetch tokeninfo ทุกกรณี: aud ผิด, domain ผิด, email_verified false, หมดอายุ), SessionStore (TTL, resume ผิด email), parse frame
- integration: start server บน port สุ่มใน test → client `ws` ส่ง `hello` + MockAudio (stream PCM จากไฟล์ทดสอบตามเวลาจริง 100 ms/เฟรม) → assert message ที่ได้ · provider ใช้ fake adapter
- มือ / QA: `pnpm --filter server dev` (:8080) แล้วขับด้วย client script · ใบที่แตะ provider ต้องรันของจริงอย่างน้อย 1 ครั้ง
- ทุกครั้ง: grep stdout ของ server ที่รันหาข้อความจากไฟล์เสียงทดสอบ / `ya29.` / `Bearer` → ต้องไม่เจอ

## กับดัก
- เชื่อ email ที่ client ส่งมา แทนที่จะเอาจาก tokeninfo
- ไม่เช็ก `aud` → token ของแอปอื่นที่ผู้ใช้เคยให้ใช้แทนได้
- ใส่ token ใน query string ของ `/ws` → ไปโผล่ใน request log ของ Cloud Run
- `setInterval` ของ heartbeat / STT ไม่ถูกล้างตอน socket ปิด → memory รั่ว และ instance ไม่ยอม idle
- เขียนไฟล์เสียงลง `/tmp` เพื่อ debug — `/tmp` บน Cloud Run คือ memory แต่ยังผิด D11
