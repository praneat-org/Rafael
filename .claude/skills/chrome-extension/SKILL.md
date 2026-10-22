---
name: chrome-extension
description: วิธีเขียน apps/extension ของ Rafael — Chrome MV3 + WXT + React + TS, Side Panel UI, offscreen document สำหรับจับเสียง + WebSocket, tabCapture + mic, AudioWorklet แปลงเป็น PCM16 16 kHz, chrome.identity, ข้อห้าม remote code และวิธีทดสอบด้วย Playwright ใช้ทุกครั้งที่แตะ apps/extension
---

# Chrome extension — Rafael

MV3 · WXT · React · TypeScript strict · type ของ message จาก `packages/protocol` (zod)

## โครงไฟล์ (WXT entrypoints)
```
apps/extension/
  wxt.config.ts                # manifest: key, oauth2, permissions, side_panel
  entrypoints/background.ts    # service worker: action click, tabCapture id, สร้าง offscreen, ส่งต่อ message
  entrypoints/sidepanel/       # React UI: Setup (เลือก pack) → Live (cue) → จบ session
  entrypoints/offscreen/       # unlisted page: getUserMedia + AudioContext + AudioWorklet + WebSocket
  entrypoints/permission/      # หน้า visible สำหรับขอ mic ครั้งแรก
  public/pcm-worklet.js        # AudioWorkletProcessor (ต้องเป็นไฟล์ local)
```

## ใครถืออะไร
- **Service worker ตายได้ทุกเมื่อ** (idle ~30 วิ) → ห้ามถือ WebSocket, AudioContext หรือ state ของ session · ใช้แค่ประสาน
- **Offscreen document** (`chrome.offscreen.createDocument({ url, reasons: ['USER_MEDIA'], justification })`) ถือ stream เสียง + WebSocket ตลอด session · มีได้ทีละ 1 อัน เช็กก่อนสร้างด้วย `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })`
- offscreen ใช้ chrome API ได้แค่ `chrome.runtime` → token / ค่าตั้งต้นส่งเข้าไปทาง message จาก SW / side panel
- **Side Panel** แสดงผลอย่างเดียว · เปิดด้วย `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` · ปิด panel ≠ หยุด session (offscreen ยังทำงาน) ต้องมีปุ่มหยุดชัด

## เสียงแท็บ (tabCapture)
1. ต้องมาจาก user gesture บนแท็บนั้น (action click / command) — กดปุ่มใน side panel อย่างเดียวอาจได้ "Extension has not been invoked for the current page"
2. SW: `const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })` (ไม่ใส่ `consumerTabId` → ใช้ใน offscreen ได้) → ส่ง id เข้า offscreen
3. offscreen:
   ```ts
   const tab = await navigator.mediaDevices.getUserMedia({
     audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as any,
     video: false,
   });
   const src = ctx.createMediaStreamSource(tab);
   src.connect(ctx.destination);   // ต้องต่อกลับลำโพง ไม่งั้นแท็บประชุมเงียบ ผู้ใช้ไม่ได้ยินลูกค้า
   src.connect(worklet);
   ```
- streamId หมดอายุเร็ว (ไม่กี่วินาที) ใช้ทันที

## ไมค์
- offscreen **ขอ permission ไมค์ไม่ได้** (ไม่มี UI ให้ prompt) → เปิดหน้า `permission.html` เป็นแท็บครั้งแรก เรียก `getUserMedia({ audio: true })` แล้วปิด · permission ผูกกับ origin ของ extension ใช้ใน offscreen ได้ต่อ
- offscreen เช็ก `navigator.permissions.query({ name: 'microphone' })` ก่อน → ไม่ใช่ `granted` → บอก side panel ให้พาไปหน้า permission
- ไมค์ไม่ต้อง connect ไป destination (จะได้ยินเสียงตัวเอง)

## AudioWorklet → PCM16 16 kHz mono เฟรม 100 ms
- `new AudioContext({ sampleRate: 16000 })` ให้ Chrome resample ให้ (ถ้าต้องทำเองใน worklet ให้ low-pass ก่อน decimate)
- worklet ได้ทีละ 128 sample → สะสมให้ครบ 1600 sample (100 ms) → mix tab + mic เป็น mono → clamp → `Int16Array` → `port.postMessage(buf, [buf.buffer])`
- offscreen ห่อเป็น binary frame ตาม `packages/protocol` แล้ว `ws.send()` · `ws.bufferedAmount` สูง → ทิ้งเฟรมเก่า ไม่สะสม
- `ctx.resume()` หลังสร้าง · ตอนหยุด: `track.stop()` ทุก track + `ctx.close()` + ปิด ws

## Auth
- `chrome.identity.getAuthToken({ interactive: true })` (scopes ใน manifest `oauth2`: `openid email profile https://www.googleapis.com/auth/drive.readonly`)
- OAuth client ชนิด "Chrome extension" ผูกกับ extension ID → ต้องตั้ง manifest `key` ให้ ID คงที่ทั้ง dev / unpacked / production · ใช้ได้เฉพาะ Chrome ที่ login profile
- ส่ง token ใน message แรกของ WebSocket ไม่ใส่ใน URL · server ตอบ 401 / auth error → `chrome.identity.removeCachedAuthToken({ token })` แล้วขอใหม่ครั้งเดียว
- **ห้ามเก็บ token** ใน `chrome.storage` / localStorage — ขอใหม่จาก `getAuthToken` (มี cache ในตัว)

## Session Pack (Drive)
- ห้าม remote code (MV3) → ใช้ Google Picker ไม่ได้ · ให้ผู้ใช้วาง URL ของโฟลเดอร์ หรือค้นโฟลเดอร์ด้วย Drive API `files.list` (`mimeType='application/vnd.google-apps.folder'`) ด้วย `fetch`
- extension ส่งแค่ folder id ให้ server — server เป็นคนอ่านไฟล์

## เก็บอะไรได้ (D11)
- `chrome.storage` เก็บได้แค่ค่าตั้งค่า (server URL, folder id ล่าสุด) · ห้ามเสียง / transcript / cue / เนื้อหา pack / token · IndexedDB ไม่ใช้
- log ใน console ห้ามมีข้อความ cue / transcript

## UI Side Panel
- ต้องใช้ได้ที่กว้าง ~360px ถึง ~500px · cue ใหม่ต่อท้ายใน container ที่จองความสูงไว้ (ไม่ดัน layout — CLS)
- แสดง anchor `[file › page]` ตามที่ server ส่ง · `notFound` → ข้อความ "ไม่พบใน pack" · cue แบบ partial อัปเดตใน element เดิม
- สถานะการเชื่อมต่อ (connecting / live / reconnecting) เห็นชัด

## Dev / ทดสอบ
- `pnpm --filter extension dev` (WXT เปิด Chrome พร้อม extension) หรือ build แล้ว load unpacked จาก `.output/chrome-mv3` · server ที่ `http://localhost:8080` (`ws://localhost:8080/ws`)
- unit (vitest): reducer ของ cue, การแปลง PCM, การ parse message — ไม่ import `chrome.*` ตรง ๆ ในไฟล์ที่ test
- Playwright: `chromium.launchPersistentContext(dir, { args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] })` · หา extension id จาก `context.serviceWorkers()[0].url()` · เปิด `chrome-extension://<id>/sidepanel.html` เป็นแท็บแล้วตั้ง viewport 360 / 500
- tabCapture อัตโนมัติไม่ได้ → มีโหมดเสียงจำลองใน offscreen (เล่นไฟล์ทดสอบเข้า worklet) เปิดเฉพาะ dev build

## กับดัก
- ถือ WebSocket ใน SW → หลุดเมื่อ SW ถูกปิด
- ลืม `src.connect(ctx.destination)` → ผู้ใช้ไม่ได้ยินลูกค้าในแท็บประชุม
- ไม่มี manifest `key` → extension ID เปลี่ยน → `getAuthToken` error "bad client id"
- โหลด script จาก CDN / `eval` → ถูก reject ตอน review และ CSP block
- สร้าง offscreen ซ้ำ → error "Only a single offscreen document may be created"
