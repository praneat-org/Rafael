# Customer notice, no-use conditions, DPO data-flow brief (BE-98, CAR-3824 AC 6, 7)

DRAFT for human / DPO review. Facts come from `docs/privacy/providers.md` (BE-93, checked 2026-10-24). Claims about what our code does are limited to D11/D21 as written in the Decision log; implementing PRs must be linked before this goes to the DPO (see section 5).

## 1. Customer notice at meeting start

**DRAFT, do not send to customers yet.** The "no recording or transcript after the meeting" claim is not yet backed by merged code: current develop keeps session state in memory (BE-85) and the end-of-session cleanup and retention tests are pending BE-94, BE-96 and BE-89, plus DPO approval.

TH: "ในการประชุมนี้ ทีมของเรามีระบบช่วยฟังเพื่อค้นหาข้อมูลจากเอกสารของเราเอง ระบบของเราไม่เก็บไฟล์เสียงหรือข้อความการสนทนาไว้หลังจบการประชุม โดยเสียงและข้อความจะถูกประมวลผลโดยผู้ให้บริการภายนอกตามเงื่อนไขของผู้ให้บริการ หากไม่สะดวก แจ้งได้เลยครับ/ค่ะ เราจะปิดระบบทันที"

EN: "Our team is using an assistant in this meeting to look up answers from our own documents. Our system keeps no recording or transcript after the meeting; audio and text are processed by external service providers under their terms. If you would rather we did not, just say so and we will switch it off."

Scope: every claim is limited to our own system and says providers process under their own terms (Google keeps flagged prompts up to 90 days unless a Master Agreement applies, see section 3). DPO to finalize wording. The "after the meeting" claim stays DRAFT until BE-94, BE-96, BE-89 are merged and the DPO approves (see status column).

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

| Data | Goes to | Kept by us (proof card, status) | Kept by processor |
|---|---|---|---|
| Audio | STT provider | No. BE-89 STT adapters: not built; BE-96 retention test: PR #14 in review. Status: not implemented | Chirp 3/V2 logging: UNVERIFIED. Reference: the V1 data-logging page says "By default, Cloud Speech-to-Text does not log customer audio data or transcripts" [providers.md 3]. Deepgram: `mip_opt_out=true` must be set by the STT adapter (BE-89, not built); opted-out requests are kept only to process |
| Transcript / questions | Gemini prompt | Server memory only, TTL 24h max. BE-85 (#8): in-memory SessionStore merged; BE-96 (#14) in review. Status: partly implemented | Not used for training. Google logs prompts only if classifiers flag them, up to 90 days, in the selected region; exempt by default if Praneat has a Google Cloud Master Agreement (to check). Frontier models (e.g. Gemini 4 Argon): prompts + responses up to 30 days. Source: providers.md [10] |
| Session Pack (docs from Drive) | Drive API (read), then Gemini explicit CachedContent (D21) | Memory only (BE-85 #8 merged for session memory). Cache ttl <= 1h and delete on `session.end`: BE-94 PR #17 draft. Status: not merged | Cache ttl <= 1h; not zero-retention by Google's definition |
| Cue | Extension | No. Nothing persisted in merged code; BE-96 (#14) will test. Status: in review | n/a |
| Server logs | Cloud Logging | Metadata only, content redacted (D11). Logger redaction card: not verified here. Status: not confirmed | Google Cloud |

Processors and regions: Google Workspace / Drive API (reads the pack with the user's `drive.readonly` token; governed by the Google API Services User Data Policy and Praneat's Google agreement), Google Cloud (Cloud Run, Vertex Gemini in asia-southeast1 Singapore, no in-region ML processing guarantee) plus STT: Google Chirp 3 (asia-southeast1 unconfirmed; `us`/`eu` documented) or Deepgram (EU endpoint verified; US UNVERIFIED; no Asia endpoint found). Per provider: Vertex Gemini asia-southeast1 (no Thailand region, so outside Thailand); Drive region UNVERIFIED; Chirp 3 asia-southeast1 UNVERIFIED (`us`/`eu` documented); Deepgram EU (or US, UNVERIFIED).

Audit log (planned, BE-97, not built): session start/end, email hash, error codes, token usage; no audio / transcript / cue content by design.

## 4. Questions for the DPO

0. Does Praneat have a Google Cloud Master Agreement (default exemption from abuse-monitoring prompt logging)? If we choose a Frontier model (e.g. Gemini 4 Argon), prompts + responses are logged up to 30 days: acceptable?

1. Is Singapore / US / EU processing acceptable under PDPA cross-border rules with a DPA, or must processing stay in an ASEAN-only region?
2. Is "does not record" wording acceptable given external STT and Google abuse-monitoring logs? Do we need to request an exception from Google?
3. Is an oral notice sufficient, or is written consent needed per customer?
4. Do Session Pack documents count as personal data when they contain customer names / contacts?
5. Is a Gemini explicit cache of <= 1h acceptable?
6. Which customer segments are excluded (section 2)?

## 5. Proof needed before sending (not yet verified)

- D11 enforcement (no content in logs): BE-85 (#8) merged; BE-96 retention test (#14) in review.
- D21 cache deleted on `session.end`: BE-94 (#17) draft, not merged.
- Deepgram `mip_opt_out` / Chirp no-logging config: STT adapters BE-89 not built.
- Google written answers on abuse logging and explicit-cache ZDR.
