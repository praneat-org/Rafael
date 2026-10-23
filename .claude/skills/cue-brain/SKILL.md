---
name: cue-brain
description: วิธีเขียน apps/server/src/brain ของ Rafael — Detector จับคำถามลูกค้าจาก transcript, Answerer ตอบจาก Session Pack เท่านั้นพร้อม anchor [file › page], context caching (Gemini ผ่าน Vertex AI, D20), ตรวจ anchor หลัง generate, stream partial cue, latency budget ต่อ stage และ eval ใช้เมื่อแตะ brain/, eval/ หรือ prompt
---

# Cue brain — Rafael

transcript (จาก STT) → **Detector** → คำถาม → **Answerer** (+ Session Pack) → cue (≤3 bullet, ทุก bullet มี anchor) → stream ไป extension

## Config
- LLM = Google Gemini ผ่าน Vertex AI (D20) เรียกผ่าน `LlmClient` (provider-agnostic) · model ยังไม่ล็อก
- model id มาจาก env / config: `DETECTOR_MODEL` (ตัวเล็ก เร็ว), `ANSWERER_MODEL` · ห้าม hardcode ในโค้ดหรือ prompt
- ค่าที่ปรับได้ (ขนาด window, dedupe, จำนวน bullet, max_tokens) อยู่ใน config เดียว ไม่กระจาย

## Detector
- input: transcript final ย้อนหลัง **30 วิ** (rolling window) · เรียกเมื่อมี segment final ใหม่ ไม่ใช่ทุก partial
- output (JSON / tool call ที่ schema ชัด): `{ isQuestion, question, confidence }` · parse ด้วย zod ไม่ผ่าน → ถือว่าไม่ใช่คำถาม
- **กรองคำถามเชิงวาทศิลป์ของคนพิช** ("รู้ไหมครับว่า…", "แล้วผลเป็นยังไง? ผลคือ…") — ให้ prompt บอกชัดว่าต้องเป็นคำถามที่ลูกค้าถามและคาดหวังคำตอบ · มีตัวอย่าง negative ใน prompt
- **dedupe 60 วิ:** normalize คำถาม (ตัดช่องว่าง / คำลงท้าย) แล้วเทียบกับคำถามที่ตอบไปใน 60 วิล่าสุดของ session → ซ้ำ / ใกล้เคียง → ไม่ตอบซ้ำ
- งบ: ≤ 600 ms · `max_tokens` ต่ำ

## Answerer
- Session Pack = ข้อความที่ดึงจาก Drive แบ่งเป็นชิ้นที่มี id `[file › page]` ชัด (file = ชื่อไฟล์, page = หน้า / slide / section)
- ใส่ pack เป็น **cached prefix**: block ใน `system` ที่ลำดับและเนื้อหาไม่เปลี่ยนตลอด session + สร้างเป็น Gemini context cache (`cachedContent`) จาก prefix นั้น (ผ่าน `LlmClient`) · คำถามอยู่ใน `messages` หลัง prefix เสมอ (เปลี่ยน prefix = cache miss ทุกครั้ง)
- warm cache ตอนโหลด pack เสร็จ (เรียกสั้น ๆ 1 ครั้ง) เพื่อให้คำถามแรกไม่ช้า · cache หมดอายุเมื่อเงียบนาน → ดู cached token count ใน usage metadata (`cachedContentTokenCount`) ใน log เพื่อยืนยันว่า hit
- กติกาใน prompt: ตอบจาก pack เท่านั้น · ≤ 3 bullet · bullet ละ ≤ 15 คำ · ทุก bullet ลงท้ายด้วย anchor `[file › page]` ที่มีใน pack · ไม่มีข้อมูล → `notFound`
- **stream:** ใช้ streaming API ส่ง partial cue ทุกครั้งที่ bullet ครบหนึ่งอัน (ไม่ส่งครึ่ง anchor) · first token ≤ 1200 ms

## ตรวจ anchor หลัง generate (D10)
1. parse ทุก bullet → ดึง anchor
2. anchor ต้องตรงกับ chunk id ที่มีอยู่จริงใน pack index ของ session นี้
3. bullet ที่ไม่มี anchor / anchor ไม่มีจริง → **ตัดทิ้ง**
4. ไม่เหลือ bullet → `notFound: true`, sources ว่าง
5. cue ที่ `notFound=false` → `sources` = anchor ที่ผ่านการตรวจเท่านั้น
- partial cue ก็ตรวจ anchor ก่อนส่งเหมือนกัน · ห้ามให้ model สร้าง sources แยกจาก bullet แล้วเชื่อเลย

## Latency budget (log ทุก stage)
| stage | งบ |
| -- | -- |
| STT (เสียงจบ → final segment) | ≤ 800 ms |
| Detector | ≤ 600 ms |
| Answerer first token | ≤ 1200 ms |
| รวม (ลูกค้าพูดจบ → cue แรกขึ้น) | p50 ≤ 3 s · p95 ≤ 5 s |
- log ต่อคำถาม: `{ sessionId, stage, ms, model, inputTokens, cacheReadTokens, outputTokens }` — **ไม่มีข้อความคำถาม / คำตอบ** (D11)
- วัดด้วย `performance.now()` ฝั่ง server · เกินงบ → log warn พร้อม stage

## Eval (`eval/`)
- golden set: pack ตัวอย่างที่ไม่ใช่ข้อมูลลูกค้า + transcript + คำตอบ / anchor ที่คาดหวัง · อยู่นอก repo ถ้ามีเนื้อหา deal จริง
- วัด: detector precision / recall (รวม rhetorical), anchor validity = 100%, notFound ถูกเมื่อคำถามนอก pack, latency p50 / p95
- เปลี่ยน prompt / model → รัน eval ก่อนส่ง แล้วแนบตัวเลขเทียบเดิมใน comment

## Test
- unit: anchor parser + verifier (anchor ปลอม, anchor ถูกครึ่ง, ไม่มี anchor, ทุก bullet ตก → notFound), dedupe 60 วิ (ส่งเวลาเข้าไป ไม่ใช้ `Date.now()` ตรง), ตัด bullet > 3 / คำ > 15
- Detector / Answerer ใน test ใช้ fake client · รัน provider จริงเฉพาะ eval / QA

## กับดัก
- ใส่ timestamp / sessionId ไว้ใน system ก่อน pack → cache miss ทุกครั้ง
- เชื่อ anchor จาก model โดยไม่ตรวจ → ผิด D10
- เรียก Detector ทุก partial transcript → เกินงบและค่าใช้จ่ายพุ่ง
- log `response.content` เพื่อ debug → ผิด D11
