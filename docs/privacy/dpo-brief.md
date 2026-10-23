# Customer notice, no-use conditions, DPO data-flow brief (BE-98, CAR-3824 AC 6, 7)

DRAFT for human / DPO review. Facts come from `docs/privacy/providers.md` (BE-93, checked 2026-10-24). Claims about what our code does are limited to D11/D21 as written in the Decision log; implementing PRs must be linked before this goes to the DPO (see section 5).

## 1. Customer notice at meeting start

TH: "ในการประชุมนี้ ทีมของเรามีระบบช่วยฟังเพื่อค้นหาข้อมูลจากเอกสารของเราเอง มาตอบคำถามได้เร็วขึ้น โดยไม่บันทึกเสียงและไม่เก็บข้อความการสนทนา หากไม่สะดวก แจ้งได้เลยครับ/ค่ะ เราจะปิดระบบทันที"

EN: "Our team is using an assistant that listens during this meeting to look up answers from our own documents faster. It does not record the audio or keep a transcript. If you would rather we did not, just say so and we will switch it off."

Wording caution: "does not record" is true for our servers (D11), but audio is processed by an external STT provider and Google may log prompts for abuse monitoring (providers.md). Legal/DPO must decide whether to add "ประมวลผลโดยผู้ให้บริการภายนอก". Do not use the notice until settled.

## 2. Do not use when

- Customer has not consented, or objects at any time (stop immediately).
- Government / public-sector confidential meetings.
- Sensitive personal data is expected (health, religion, biometrics, criminal records, etc.).
- Contract or NDA forbids AI tools or third-party processing.
- Customer requires data to stay in Thailand (no Thailand region exists; LLM in Singapore at best, STT possibly US/EU).
- The notice has not been given first (for example, the rep joined late).

## 3. Data flow (for DPO)

```
Rep mic + tab audio -> Chrome extension -> WSS -> Cloud Run asia-southeast1 (memory only)
  audio PCM -------------------------> STT provider (Chirp 3 or Deepgram, undecided) -> transcript text
  transcript window + Session Pack (from rep's Drive) -> Vertex AI Gemini -> cue (<=3 bullets + [file > page])
  cue -> extension side panel (rep's screen only)
```

| Data | Goes to | Kept by us | Kept by processor |
|---|---|---|---|
| Audio | STT provider | No (D11: no disk / bucket / log) | Chirp 3: not logged unless we opt in. Deepgram: `mip_opt_out=true`, kept only to process |
| Transcript / questions | Gemini prompt | Server memory for the session only (TTL 24h max, dropped at end) | Not used for training; Google may log prompts for abuse monitoring (exemption UNVERIFIED) |
| Session Pack (docs from Drive) | Gemini explicit CachedContent (D21) | Memory only | ttl <= 1h, deleted on `session.end`; not zero-retention by Google's definition |
| Cue | Extension | No | n/a |
| Server logs | Cloud Logging | Metadata only (session id, email hash, sizes, latency, tokens); content redacted (D11) | Google Cloud |

Processors and regions: Google Cloud (Cloud Run, Vertex Gemini in asia-southeast1 Singapore, no in-region ML processing guarantee) plus STT: Google Chirp 3 (asia-southeast1 unconfirmed; `us`/`eu` documented) or Deepgram (EU/US endpoints; no Asia endpoint found). All involve cross-border transfer out of Thailand.

Audit log: session start/end, email hash, error codes, token usage. No audio / transcript / cue content.

## 4. Questions for the DPO

1. Is Singapore / US / EU processing acceptable under PDPA cross-border rules with a DPA, or must processing stay in an ASEAN-only region?
2. Is "does not record" wording acceptable given external STT and Google abuse-monitoring logs? Do we need to request an exception from Google?
3. Is an oral notice sufficient, or is written consent needed per customer?
4. Do Session Pack documents count as personal data when they contain customer names / contacts?
5. Is a Gemini explicit cache of <= 1h acceptable?
6. Which customer segments are excluded (section 2)?

## 5. Proof needed before sending (not yet verified)

- D11 enforcement (no content in logs): logger redaction PR (server skeleton BE-85; link on review).
- D21 cache deleted on `session.end`: brain/cache PR not merged yet (UNVERIFIED).
- Deepgram `mip_opt_out` / Chirp no-logging config: adapters (BE-77/79) not built yet.
- Google written answers on abuse logging and explicit-cache ZDR.
