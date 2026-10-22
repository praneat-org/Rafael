# Desk research: Fireflies / Otter / Fathom (data policy, Drive, ราคา)

Linear BE-69 (parent BE-61, Jira CAR-3818 AC ข้อ 4, 5, 6) · input ของ BE-78 (ตารางเทียบ + Buy/Build/Kill) · **เข้าถึงข้อมูลทั้งหมดวันที่ 2026-10-23**

กติกา: ทุกข้ออ้าง URL · "ไม่พบ" = ไม่เจอในแหล่งที่เปิดอ่านได้ ไม่ได้แปลว่าไม่มี · ไม่มีการเดา
ข้อจำกัดของวิธี: อ่านหน้าเว็บผ่านเครื่องมือ fetch + สรุปอัตโนมัติ (ไม่ได้เปิดด้วยเบราว์เซอร์จริง) · Trust Center ของทั้ง 3 ตัว (`trust.fireflies.ai`, `trust.otter.ai` ได้แค่ชื่อ certification, `trust.fathom.video`) เป็นหน้า dynamic อ่านเนื้อหาไม่ได้ · หน้าราคาเป็นราคาบนเว็บ ณ วันที่เข้าถึง ไม่ใช่ใบเสนอราคา · **ก่อนตัดสินใจให้คนเปิดลิงก์ยืนยันอีกครั้ง**

## 1. ตารางเทียบ

| | Fireflies | Otter | Fathom |
| -- | -- | -- | -- |
| Region ที่เก็บข้อมูล | US (บริษัทอยู่ US, service provider เก็บ "on servers located in the United States and other countries" [F2]). Private Storage (data locality) เฉพาะ Enterprise [F3] · region ที่เลือกได้: ไม่พบ | US: ใช้ AWS "based in the United States" [O1] · ข้อมูลอาจย้ายออกนอกประเทศ (ใช้ SCC สำหรับ EEA/UK) [O1] · option เลือก region: ไม่พบ | "hosted in the United States" [T1] · DPA ระบุอาจโอนออกนอก EEA/UK, certified EU-U.S. DPF [T3] · option เลือก region: ไม่พบ |
| Retention | บัญชี: เก็บตราบที่บัญชี active, ปิดบัญชี → ลบใน 30 วัน [F2] · เนื้อหาประชุม: นโยบาย "Zero Data Retention" = ไม่เก็บที่ third-party vendor หลังประมวลผล [F2][F3] (ระยะเวลาเก็บที่ Fireflies เอง: ไม่พบ) · Enterprise ตั้ง auto-delete ตามช่วงเวลาได้ [F4] | "as long as necessary" [O1] · ไม่มี retention period ตัวเลข · Custom data retention อยู่ในรายการฟีเจอร์ แต่ไม่ระบุแผน [O2] | "as long as necessary" [T1] · Custom data retention programs อยู่ Enterprise [T2] |
| ลบได้ไหม | ได้ ผ่าน settings / support · ผู้ที่ไม่ใช่ user ต้องให้ host ลบ [F2] | ขอลบได้ทาง privacy@otter.ai / ฟอร์ม [O1] · self-service ลบ recording: ไม่พบในหน้านี้ | ลบบัญชีใน settings → "commercially reasonable efforts" ลบใน 30 วัน (ไม่การันตี) · แผน Team/Business/Enterprise ต้องขอผ่าน admin [T1] |
| ใช้ train model ไหม | **ไม่** · "Your data is never used to train AI models, internally or externally" [F3] · privacy policy: meeting content ไม่ใช้ train [F2] | **ใช่ (ตาม policy)** · ระบุ purpose "training our proprietary AI technology on de-identified audio recordings and on transcriptions (which may contain Personal Information)" [O1] · opt-out เฉพาะ training: ไม่พบ | **ใช่ โดย default ตามแผน/ตั้งค่า** · de-identified data จาก meeting content ใช้ train โมเดลของ Fathom เอง · **opt-out ได้ใน account settings** · ไม่อนุญาตให้ third party train [T1] |
| DPA | มีหน้าให้เซ็น DPA [F5] · เนื้อหา DPA (ที่เก็บ, retention หลังเลิกสัญญา, sub-processor): ไม่พบ · sub-processor list: `trust.fireflies.ai/subprocessors` อ่านไม่ได้ | privacy policy ไม่กล่าวถึง DPA [O1] · `otter.ai/dpa` อ่านไม่ได้ · ไม่พบ | **มี** DPA สาธารณะ [T3] · ไม่ระบุ retention ตายตัว ("return or delete ... at Customer's instruction") · แจ้งเปลี่ยน sub-processor ≥ 10 วันทำการ, ค้านได้ 30 วัน |
| SOC 2 | SOC 2 Type II + ISO/IEC 42001 ทุกแผน รวม Free [F4] · audit ประจำปี [F3] | SOC 2 (Trust Center ระบุ certification SOC 2, HIPAA, GDPR, CCPA, VPAT, TX-RAMP L2 [O3]) · SOC 2 Type II ประกาศ ม.ค. 2023 [O4] · รายงานล่าสุด/วันที่: ไม่พบ (ต้องขอ) | หน้า privacy + pricing ไม่ระบุ [T1][T2] · Trust Center อ่านไม่ได้ · ไม่พบจากแหล่งทางการ (แหล่งรองบอก SOC 2 Type II แต่ไม่ใช้เป็นข้อเท็จจริง) |
| ดึง source จาก Google Drive folder | **ไม่พบใน doc ทางการ** · Sales Assist knowledge base = upload ไฟล์ (PDF, DOCX, XLSX, XLS, CSV, TXT, MD, HTML) หรือใส่ URL เว็บให้ crawl [F1] · มี Zapier template Drive folder → upload เป็น audio (เป็น third-party ไม่ใช่ knowledge base) | **ไม่พบ** · Sales Agent: ทีม Otter ตั้งค่าให้เองจากข้อมูลบริษัท/ประชุมเก่า (white glove) [O5] · Live Assist (Enterprise): ใช้ playbook / SOP / past meetings ผ่าน Agent Builder ไม่ระบุว่าดึงจาก Drive [O6] · "AI Chat with Gmail, Google Drive, Notion, Jira" ติดป้าย Coming Soon/New ในการ์ด Enterprise (chat ไม่ใช่ live) [O2] | **ไม่พบ** · ไม่เห็น Drive ใน pricing [T2] · เป็น post-call recap (live ไม่ยืนยัน) |
| Sync เมื่อไฟล์เปลี่ยน | ไม่พบ (upload เอง → น่าจะ static แต่**ไม่มีแหล่งยืนยัน**) | ไม่พบ | ไม่พบ |
| Real-time assist ต้องมี bot ไหม | **Live Assist (Chrome extension) = bot-free, Google Meet บน Chrome เท่านั้น** [F6] · **Sales Assist ต้องให้ Notetaker bot join** · desktop app = "coming soon" [F1] | ไม่ระบุในแหล่งที่อ่านได้ · Live Assist: "joins your calls on its own", ไม่ระบุว่าเป็น bot participant หรือไม่ · Zoom / Meet / Teams / desktop app (จากผลค้นหา ยังไม่ยืนยันตรง) [O6] | ไม่พบ real-time ใน pricing [T2] |
| ราคา per-seat (ราคาบนเว็บ) | Free $0 · Pro $10 annual / $18 monthly · Business $19 / $29 · Enterprise $39 annual only, ต้องขอใบเสนอราคา [F4 (blog 10 ก.ค. 2026)] · **หน้า `fireflies.ai/pricing` ไม่แสดงตัวเลข อ่านผ่านเครื่องมือไม่ได้ → ตัวเลขมาจาก blog ของ Fireflies เอง** · Live Assist: help page ระบุใช้ได้ทั้ง free และ paid (บางฟีเจอร์ เช่น Dynamic Topic Suggestions เฉพาะ paid) และ AskFred กิน AI credits ต่อ query [F6] · blog [F4] จัดไว้ใต้ Pro ซึ่งไม่ขัดกัน (ไม่ได้บอกว่า Pro เท่านั้น) · Sales Assist ใช้ได้ทุกผู้ใช้รวม free แต่กิน AI credits ต่อ query [F1] · **ตัวเลข 3–5 seat ใช้ Business annual ≈ $57–95/เดือน เพราะ Business มี Deal Intelligence และ unlimited storage สำหรับทีม sales และไม่ต้องคุย sales; ขั้นต่ำที่ใช้ Live Assist ได้คือ Pro ≈ $30–50/เดือน หรือ Free (ถูกจำกัดด้วย credits)** · ราคาทุกแผนยังไม่รวมค่า credits ที่ใช้เพิ่ม | Basic ฟรี · Pro $8.33 annual list ($16.99 monthly) · Business $19.99 annual ($30 monthly) · Enterprise: "Schedule a demo" [O2] (หน้ามีโปรโมชันลด 50%/20% ที่ footnote ไม่ชัด ใช้ list price) · **Sales Agent / Live Assist: ประกาศสำหรับลูกค้า Enterprise ("Already an Otter Enterprise customer? Talk to your CSM or AE to get set up" [O6]; Sales Agent "available to Otter enterprise sales customers" [O5]) · แผนอื่น: ไม่พบข้อมูล · ราคา: ไม่พบ** | Free $0 · Premium $16 annual / $20 monthly · Team $15 / $19 (min 2 users) · Business $25 / $34 (min 2) · Enterprise ต้องคุย sales [T2] · ไม่มีแผนใดระบุ real-time |
| ลิงก์หลัก | F1–F6 ด้านล่าง | O1–O6 | T1–T3 |

## 2. ข้อสังเกตที่ BE-78 ควรใช้

* **ตัวเดียวที่ bot-free + real-time ตรงโจทย์ (ห้องจริง) คือ Fireflies Live Assist** แต่จำกัด Google Meet บน Chrome และไม่พบ doc ว่าใช้ knowledge base จาก Drive · Sales Assist (มี KB) ต้องมี bot
* **Otter Live Assist / Sales Agent: ประกาศสำหรับลูกค้า Enterprise แผนอื่นไม่พบข้อมูล** ราคาไม่เปิดเผย · **Otter มี training clause ใน policy** ขัดกับ D11 ถ้าใช้ข้อมูล deal จริง
* **Fathom ไม่พบ real-time assist** จากแหล่งทางการที่อ่านได้ · มี opt-out train
* **ไม่มีตัวไหนที่ doc ทางการยืนยัน Drive folder + auto-sync** → ช่องว่างที่ Build อาจตอบ (ต้องยืนยันด้วยการทดสอบจริงใน BE-73, BE-74, BE-75 และถาม sales)
* ทั้ง 3 ตัวเก็บข้อมูลใน US ไม่พบ option region ไทย/เอเชีย (ยกเว้น Fireflies Enterprise Private Storage ไม่ระบุ region)

## 3. คำถามที่ต้องให้คนถาม sales / security เอง

Fireflies
1. Live Assist / Sales Assist ใช้แผนไหน, credit ต่อ query เท่าไร, 3–5 seat เดือนละกี่ credit
2. Knowledge base ดึงจาก Google Drive folder ได้ไหม · sync เมื่อไฟล์เปลี่ยนไหม · Live Assist (bot-free) ใช้ KB ได้ไหม
3. Sales Assist desktop app (bot-free?) เปิดเมื่อไร
4. DPA ฉบับเต็ม: region, retention ฝั่ง Fireflies หลังประมวลผล, sub-processor list
5. Private Storage เลือก region ไหนได้ (มี Singapore/Thailand ไหม) · ราคา Enterprise 3–5 seat
6. ภาษาไทยใน live transcript (ไม่พบ list ทางการ)

Otter
1. Live Assist / Sales Agent มีให้แผนอื่นนอกจาก Enterprise ไหม · ราคาต่อ seat, minimum seat, ทดลองใช้ได้ไหม
2. Knowledge source ของ Agent Builder: Google Drive folder ได้ไหม, sync อัตโนมัติไหม
3. Training clause: opt-out ได้ไหม · Enterprise ถูกยกเว้นไหม · "de-identified" กับ transcript เป็นอย่างไร
4. DPA, region ที่เลือกได้, retention ตัวเลข, SOC 2 Type II report ล่าสุด
5. Live Assist ต้องมี bot ไหมในห้องจริง · ภาษาไทย

Fathom
1. มี real-time / live assist หรือแผนจะมีไหม (ไม่พบใน pricing)
2. SOC 2 report + region ที่เก็บข้อมูล, option นอก US
3. Google Drive เป็น source ได้ไหม
4. Enterprise ราคา 3–5 seat · opt-out training ทำระดับ org ได้ไหม
5. ภาษาไทยใน transcript

## 4. ข้อเสนอเบื้องต้น (ยังไม่ใช่ข้อสรุป — รอผลทดสอบ BE-73, BE-74, BE-75 และ gate BE-80)

* **Buy:** ยังไม่มีตัวที่ doc ยืนยันครบทั้ง bot-free + real-time + Drive source + ราคาโปร่งใส · Fireflies Live Assist ใกล้สุดแต่ติด Meet-only + Drive ไม่ยืนยัน
* **Build:** ช่องว่างที่เห็นจาก desk research: Drive folder เป็น source พร้อม anchor, data policy แบบไม่เก็บข้อมูล (D11) ที่ตรวจสอบได้, ภาษาไทย (ยังไม่ยืนยัน)
* **Kill:** ไม่มีหลักฐานจาก desk research ที่ชี้ให้ Kill

## แหล่งอ้างอิง (เข้าถึง 2026-10-23)

Fireflies
* F1 https://guide.fireflies.ai/articles/7857491198-sales-assist-how-to-use-live-assist-for-sales-teams-during-customer-calls
* F2 https://fireflies.ai/privacy-policy
* F3 https://guide.fireflies.ai/articles/2154538358-policy-on-keeping-information-safe
* F4 https://fireflies.ai/blog/fireflies-pricing-which-plan-is-right-for-you/ (ลงวันที่ 10 ก.ค. 2026) · `https://fireflies.ai/pricing` อ่านตัวเลขไม่ได้
* F5 https://fireflies.ai/dpa
* F6 https://guide.fireflies.ai/articles/7077919424-explore-the-real-time-pane-on-the-fireflies-chrome-extension

Otter
* O1 https://otter.ai/privacy-policy
* O2 https://otter.ai/pricing
* O3 https://trust.otter.ai
* O4 https://www.businesswire.com/news/home/20230104005207/en/Otter.ai-Achieves-SOC-2-Type-II-Attestation-Report
* O5 https://fastcompanyme.com/work-life/otters-new-ai-agents-are-built-to-boost-sales-and-streamline-meetings/ (27 มี.ค. 2025 · แหล่งรอง)
* O6 https://otter.ai/blog/your-calls-have-a-coach-now-how-to-use-live-assist (อ่านตรง 2026-10-23: playbooks/SOPs/old call transcripts/battlecards/onboarding docs เป็น source, "plugs into things like Claude and Salesforce", ไม่กล่าวถึง Google Drive/ภาษา/ราคา) · ประกาศ BusinessWire https://www.businesswire.com/news/home/20260721446216/en/ fetch ตรงไม่ได้ (403)

Fathom
* T1 https://fathom.ai/privacy
* T2 https://fathom.ai/pricing
* T3 https://fathom.ai/dpa

## วิธีตรวจซ้ำ

เปิดลิงก์ด้านบนในเบราว์เซอร์ แล้วเทียบกับแต่ละช่องในตาราง · ช่อง "ไม่พบ" ให้ตรวจ Trust Center ที่ต้องเปิดด้วยเบราว์เซอร์ + ถาม sales ตามข้อ 3
