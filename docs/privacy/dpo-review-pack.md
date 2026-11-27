# ชุดเอกสารให้ DPO / ฝ่ายกฎหมาย review — Rafael (BE-100, CAR-3824 AC ข้อ 7)

สถานะ: **ร่างสำหรับส่ง ยังไม่ได้ส่ง** · เตรียมจากโค้ดบน `develop` (commit c5c47ff, 2026-11-02) และเอกสารผู้ให้บริการที่ตรวจวันที่ 2026-10-24 / 2026-11-02 · ข้อที่ยืนยันไม่ได้ติดป้าย **ยังไม่ยืนยัน** · ไม่ใช่คำแนะนำทางกฎหมาย
เอกสารประกอบ: `docs/privacy/dpo-brief.md` (ประโยคแจ้งลูกค้า, เงื่อนไขห้ามใช้), `docs/privacy/providers.md` (ตารางผู้ให้บริการ + แหล่งอ้างอิง [1]–[17]), `docs/llm-provider.md`, `docs/deploy.md`

## 1. Rafael ทำอะไร

เครื่องมือช่วยพนักงานขาย Praneat ระหว่างประชุมกับลูกค้า: ฟังเสียงในห้อง/แท็บประชุม แปลงเป็นข้อความ จับ "คำถามของลูกค้า" แล้วแสดงคำตอบสั้น ๆ (ไม่เกิน 3 ข้อ พร้อมอ้างอิงไฟล์/หน้า) บนหน้าจอของพนักงานคนเดียว **คำตอบมาจากเอกสารที่พนักงานเลือกจาก Google Drive ของตัวเองเท่านั้น** ระบบไม่พูดตอบ ไม่ส่งอะไรถึงลูกค้า ใช้ได้เฉพาะบัญชี `@praneat.com` (dev มีรายชื่ออีเมลพิเศษ เฉพาะ dev, D23; prod ต้องว่าง)

## 2. ข้อมูลที่เกี่ยวข้องและเส้นทาง

| ข้อมูล | ไปที่ไหน | ผู้ให้บริการ / region | เก็บไว้ที่ไหน นานเท่าไร (ตรวจกับโค้ด) | ใครเข้าถึงได้ |
|---|---|---|---|---|
| เสียง (stream) | extension → server (Cloud Run) → STT | Google Vertex AI Gemini Live (`gemini-3.5-transcribe-live`) ที่ location **`global`** (D22, D24) | ไม่เขียนลง disk/bucket/log: โค้ดฝั่ง server ไม่มีการเขียนไฟล์เสียง (`apps/server/src/stt/gemini.ts`, `privacy.test.ts`, `log.ts` มี allowlist ไม่มี field เสียง) · ฝั่ง Google: ไม่มีหน้าเอกสารที่ระบุ retention ของ Live API STT **(ยังไม่ยืนยัน)** | พนักงานเจ้าของ session; ฝั่งเราไม่เก็บเสียง จึงไม่มีให้ผู้ดูแลระบบ GCP เปิดดูภายหลัง (ระหว่าง session เสียงอยู่ใน memory ของ server) |
| Transcript / คำถามที่จับได้ | server memory → Gemini (Detector, Answerer) | Vertex AI Gemini, `asia-southeast1` (`GOOGLE_CLOUD_LOCATION`) · endpoint ไม่รับประกันประมวลผลใน region | memory ของ server เท่านั้น · ลบเมื่อกด End, ปิด socket เกิน 5 นาที (`RESUME_GRACE_MS`), หรือครบ 24 ชม. นับจากสร้าง (`SESSION_TTL_MS`) ผ่าน `store.onEnd` (`session/store.ts`) · ฝั่ง Google: ไม่ใช้เทรนโดยไม่ได้รับอนุญาต [1]; มี abuse monitoring: prompt ที่ถูก classifier ติดธงเก็บได้ถึง 90 วัน ยกเว้นลูกค้าที่มี Google Cloud Master Agreement [10] (Praneat มีหรือไม่ **ยังไม่ยืนยัน**) | พนักงานเจ้าของ session |
| Session Pack (เอกสารจาก Drive) | Drive API (token `drive.readonly` ของพนักงาน) → server memory → Gemini explicit cache | Google Drive API (region **ยังไม่ยืนยัน**) · Gemini `CachedContent` ใน project ของเรา `asia-southeast1` (D21) | memory ของ server ลบตอน session จบ (`source/service.ts` onEnd) · cache ที่ Google: ttl ≤ 1 ชม. (`cacheTtlSeconds: 3600`) ลบเมื่อ session จบ (`brain/pipeline.ts`, `brain/answerer.ts` `dropCache`) · เอกสารของ Google ระบุว่า explicit cache **ไม่ใช่ zero-retention** [9] | พนักงานเจ้าของ session; สิทธิ์ตามสิทธิ์ Drive ของเขาเอง |
| Cue (คำตอบ + ข้อมูลอ้างอิง) | server → side panel ของ extension | — | ไม่เก็บ ไม่ log (log เก็บแค่จำนวน/เวลา/รหัส) · ฝั่ง extension: **ยังไม่ได้ตรวจในแพ็กนี้** (ขอบเขต FE) | พนักงานเจ้าของ session |
| Audit log | stdout → Cloud Logging | Google Cloud (log bucket retention **ยังไม่ยืนยัน**; ค่าเริ่มต้นของ Google 30 วัน; Q5 เสนอ bucket แยก 1 ปี ยังไม่ตัดสิน) | `audit.ts`: เหตุการณ์ session.start/end/expired, pack.build/refresh (folder id, **ชื่อ folder**, จำนวนไฟล์/โทเคน), auth.denied · ไม่มีเสียง/transcript/cue/ชื่อไฟล์/เนื้อหา/token · **หมายเหตุ: audit เก็บอีเมลพนักงานแบบเต็ม** (log ทั่วไปใช้ hash) ตาม AC "ใคร เปิด folder ไหน" | ผู้ดูแล GCP project ของ Rafael |
| อีเมลบัญชี Google ของพนักงาน | ตรวจ token กับ Google (`auth/google.ts`) | Google | ใน memory ระหว่าง session + audit log ตามข้างบน · ไม่เก็บ refresh token (D13) | ผู้ดูแล GCP |

Access token ของพนักงาน: ส่งในข้อความแรก `hello` (ไม่ใช่ URL, D19), ใช้อ่าน Drive ใน memory ของ session เท่านั้น ไม่ log

ข้อมูลที่ "ไม่มี": ไม่มี database, bucket, หรือ disk สำหรับเนื้อหา (deploy ไม่ให้ role Storage ตาม `docs/deploy.md`) ข้อยกเว้นเดียวของ D11 คือ Gemini cache ของ Pack (D21) · ไฟล์เสียงทดสอบภายในที่ผู้พูดยินยอมอยู่นอก repo (D11)

ข้อจำกัดที่ต้องรู้: session อยู่ใน memory ของ instance เดียว (`_MIN=1 _MAX=1` เป็นข้อเสนอ Q2 ยังไม่ตัดสิน) · deploy ยังไม่เคยรันจริงบน GCP ตาม `docs/deploy.md` ("nothing here has run against GCP yet" ณ วันที่เขียน) **ยังไม่ยืนยัน** ว่า prod ตรงกับที่ระบุ

## 3. คำถามเปิดถึง DPO (พร้อมข้อเสนอของทีม)

**Q-A · เสียงออกนอกสิงคโปร์ (Q6, D24)** — โมเดล STT `gemini-3.5-transcribe-live` ตอบเฉพาะ location `global` (404 ใน `asia-southeast1`, `us-central1`; ตรวจ 2026-10-29, `docs/llm-provider.md`) เสียงลูกค้าจึงอาจถูกประมวลผลนอก `asia-southeast1` ส่วน LLM ยังอยู่ `asia-southeast1` (ซึ่งก็ไม่ใช่ประเทศไทยและไม่รับประกัน in-region)
- ข้อเสนอ: ยอมรับ `global` ได้เฉพาะ dev (เสียงสังเคราะห์/คนในทีม) · สำหรับลูกค้าจริงให้ DPO ตัดสินว่า (ก) รับ `global` ภายใต้ Google Cloud DPA + ประโยคแจ้งลูกค้าที่ระบุการส่งต่อ หรือ (ข) รอโมเดลใน `asia-southeast1` หรือ (ค) เปลี่ยน provider · จนกว่าจะตอบ ห้ามใช้กับเสียงลูกค้าจริง
- ต้องตอบ: การส่งข้อมูลข้ามประเทศตาม PDPA ต้องใช้อะไรบ้าง (มาตราที่เกี่ยวข้อง: ยังไม่ได้ตรวจ ให้ DPO ระบุ) (Google subprocessor/transfer section ยังไม่ได้อ่าน [11])

**Q-B · Google Drive MCP (Pre-GA)** — ผู้ให้บริการ Developer Preview: ข้อกำหนดระบุ Google อาจใช้ข้อมูลที่ส่งผ่าน Pre-GA API เพื่อปรับปรุงผลิตภัณฑ์ [14][16] · region และ retention ไม่ระบุ (ตรวจ 2026-11-02) · ข้อความข้างต้นเป็นการตีความว่า Drive MCP เป็น Pre-GA (หน้า MCP ไม่ได้เขียนตรง ๆ) (`providers.md`)
- ข้อเสนอ: prod ใช้ `SOURCE_PROVIDER=driveApi` (ค่าเริ่มต้นในโค้ด `apps/server/src/index.ts`) ไม่เปิด `mcp` จนกว่า DPO ยอมรับข้อกำหนด Pre-GA หรือ Google ยืนยันเป็นลายลักษณ์อักษร (region, retention, ไม่ใช้เทรน) หรือเป็น GA
- ต้องตอบ: รับข้อเสนอนี้หรือไม่

**Q-C · ถ้อยคำแจ้งลูกค้า / ความยินยอม** — ร่างอยู่ใน `docs/privacy/dpo-brief.md` หัวข้อ 1 (ไทย + อังกฤษ) · ประโยคไทย: "ในการประชุมนี้ ทีมของเรามีระบบช่วยฟังเพื่อค้นหาข้อมูลจากเอกสารของเราเอง ระบบของเราไม่เก็บไฟล์เสียงหรือข้อความการสนทนาไว้หลังจบการประชุม โดยเสียงและข้อความจะถูกประมวลผลโดยผู้ให้บริการภายนอกตามเงื่อนไขของผู้ให้บริการ หากไม่สะดวก แจ้งได้เลยครับ/ค่ะ ทีมงานของเราจะปิดระบบให้"
- ประเด็น: (1) "ไม่เก็บ" ครอบคลุมเฉพาะระบบของเรา Google อาจเก็บ prompt ที่ถูกติดธง ≤ 90 วัน (ถ้าไม่มี CMA) (2) ไม่ได้ระบุ "ส่งออกนอกประเทศ" ถ้า Q-A ตอบว่าต้องแจ้ง ต้องเพิ่มประโยค (3) การปิดระบบเป็นแบบ manual (พนักงานกด End) ไม่มีระบบรับคำคัดค้านอัตโนมัติ
- ข้อเสนอ: แจ้งด้วยวาจาที่ต้นประชุมทุกครั้ง บันทึกใน checklist ของทีมขาย ไม่ต้องขอความยินยอมเป็นลายลักษณ์อักษร เว้นกลุ่มที่ DPO กำหนด (เช่นภาครัฐ ซึ่งเงื่อนไขห้ามใช้ในร่างไว้แล้ว)
- ต้องตอบ: ถ้อยคำสุดท้าย และวาจา vs ลายลักษณ์อักษร (หมายเหตุ: ไม่พบถ้อยคำอื่นใน repo; คอนเซ็ปต์ extension ไม่มีหน้าจอแจ้งลูกค้า)

**Q-D · Vertex AI: การใช้ข้อมูล / ไม่เทรน / abuse monitoring / cache**
- ข้อเท็จจริงจากเอกสาร Google [1][9][10] (ตรวจ 2026-10-24): ไม่ใช้ข้อมูลเทรนโดยไม่ได้รับอนุญาต · request-response logging ปิดเป็นค่าเริ่มต้น · abuse monitoring เก็บ prompt ที่ติดธงได้ ≤ 90 วัน ยกเว้นลูกค้า CMA · โมเดล "Frontier" เก็บ prompt+response ≤ 30 วัน · explicit cache ไม่ใช่ zero-retention
- ข้อเสนอ: ไม่ใช้ Frontier model / grounding / Live API session resumption · ถามทีมบัญชี Google เป็นลายลักษณ์อักษรเรื่อง CMA, abuse logging, ZDR ของ cache และ retention ของ Live API STT (ยังไม่มีเอกสารระบุ)
- ต้องตอบ: ยอมรับเงื่อนไขนี้ได้ไหม หรือต้องมีหนังสือยืนยันจาก Google ก่อนใช้กับลูกค้าจริง · Praneat มี CMA/DPA ที่ครอบคลุม Vertex และ Drive หรือไม่

คำถามเพิ่มจาก `dpo-brief.md` หัวข้อ 4 (Pack ที่มีชื่อ/ข้อมูลติดต่อลูกค้านับเป็นข้อมูลส่วนบุคคลไหม, กลุ่มลูกค้าที่ต้องไม่ใช้, retention ของ audit log) ให้ดูในเอกสารนั้น

## 4. Checklist ที่ DPO ลงนามรับรอง

- [ ] ยอมรับการประมวลผลเสียงที่ location `global` (หรือกำหนดทางเลือกอื่น) — Q-A
- [ ] ยอมรับ/ปฏิเสธ Drive MCP; prod ใช้ Drive API — Q-B
- [ ] อนุมัติถ้อยคำแจ้งลูกค้า (TH/EN) และวิธีแจ้ง (วาจา/เอกสาร) — Q-C
- [ ] ยอมรับเงื่อนไข Vertex (ไม่เทรน, abuse monitoring, cache ≤ 1 ชม.) หรือระบุเอกสารจาก Google ที่ต้องมี — Q-D
- [ ] ยอมรับรายการ "ห้ามใช้เมื่อ" (`dpo-brief.md` หัวข้อ 2)
- [ ] ยอมรับ audit log ที่เก็บอีเมลพนักงานแบบเต็ม + ชื่อ folder และ retention (เสนอ 1 ปี, Q5)
- [ ] ยอมรับว่า Drive/ Workspace DPA ครอบคลุมการอ่าน Pack
- [ ] ระบุเงื่อนไขก่อนใช้กับลูกค้าจริงครั้งแรก และผู้รับผิดชอบ

ผลที่ต้องส่งกลับ: คำตอบเป็นลายลักษณ์อักษร (อีเมล/comment) แนบใน BE-100 · ถ้อยคำที่อนุมัติแล้วลง Decision log · สิ่งที่ขอแก้เปิดเป็นใบใหม่ใต้ BE-66

## 5. ข้อมูลที่ยังยืนยันไม่ได้ (สรุป)

Praneat มี CMA/DPA หรือไม่ · region ของ Drive · retention ของ Live API STT และของ explicit cache ที่ Google · retention ของ log bucket · การทำงานจริงบน GCP (ยังไม่เคย deploy ตาม `docs/deploy.md`) · ฝั่ง extension ไม่ได้ตรวจในเอกสารนี้ · ไม่มีการรันกับ provider จริงในใบนี้ (docs only)
