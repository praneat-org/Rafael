# Customer notice, no-use conditions, DPO data-flow brief (BE-98, CAR-3824 AC 6, 7)

DRAFT for human / DPO review. Facts come from `docs/privacy/providers.md` (BE-93, checked 2026-10-24). Claims about what our code does are limited to D11/D21 as written in the Decision log; implementing PRs must be linked before this goes to the DPO (see section 5).

## 1. Customer notice at meeting start

**DRAFT, do not send to customers yet.** The "no recording or transcript after the meeting" claim is not yet backed by merged code: current develop keeps session state in memory (BE-85) and the server writes no content to disk or logs (metadata such as ids/counts is logged) (BE-96 #14), but cleanup of transcript, pack and cue on session end is pending BE-89, BE-94 and BE-108, the extension side is pending FE-37, plus DPO approval.

TH: "ในการประชุมนี้ ทีมของเรามีระบบช่วยฟังเพื่อค้นหาข้อมูลจากเอกสารของเราเอง ระบบของเราไม่เก็บไฟล์เสียงหรือข้อความการสนทนาไว้หลังจบการประชุม โดยเสียงและข้อความจะถูกประมวลผลโดยผู้ให้บริการภายนอกตามเงื่อนไขของผู้ให้บริการ หากไม่สะดวก แจ้งได้เลยครับ/ค่ะ ทีมงานของเราจะปิดระบบให้"

EN: "Our team is using an assistant in this meeting to look up answers from our own documents. Our system keeps no recording or transcript after the meeting; audio and text are processed by external service providers under their terms. If you would rather we did not, tell us and our team will switch it off."

Switch-off is manual: the code has no automatic handling of objections; the rep ends the session (`session.end`). The wording above promises only that our team will do so.

Scope: every claim is limited to our own system and says providers process under their own terms (Google keeps flagged prompts up to 90 days unless a Master Agreement applies, see section 3). DPO to finalize wording. The "after the meeting" claim stays DRAFT until BE-89, BE-94, BE-108, FE-37 are merged and the DPO approves (see status column).

## 2. Do not use when

- Customer has not consented, or objects at any time (stop immediately).
- Government / public-sector confidential meetings.
- Sensitive personal data is expected (health, religion, biometrics, criminal records, etc.).
- Contract or NDA forbids AI tools or third-party processing.
- Customer requires data to stay in Thailand (UNVERIFIED: no Thailand region is confirmed for the selected providers. Vertex AI lists `asia-southeast1` (Singapore) but regional endpoints do not guarantee in-region ML processing; Chirp 3 region support conflicts between `us`/`eu` and `asia-southeast1`; the STT provider is undecided. Do not use until providers and regions are confirmed).
- The notice has not been given first (for example, the rep joined late).

## 3. Data flow (for DPO)

```
PLANNED flow, not running on develop: STT (BE-89) not built, audio frames are only counted; Drive reader merged (BE-90 #16) but not wired into the session; Gemini not called.
Rep mic + tab audio -> Chrome extension -> WSS -> Cloud Run asia-southeast1 (content in memory only: intended, see table)
  audio PCM -------------------------> STT provider (Chirp 3 or Deepgram, undecided) -> transcript text
  transcript window + Session Pack (from rep's Drive) -> Vertex AI Gemini -> cue (<=3 bullets + [file > page])
  cue -> extension side panel (rep's screen only)
```

| Data | Goes to | Kept by us (proof card, status) | Kept by processor |
|---|---|---|---|
| Audio | STT provider | Server side: no audio content written to disk or logs (metadata such as counts is logged) (BE-96 #14 merged: retention test + log field allowlist). UNVERIFIED for the STT path: BE-89 STT adapters not built, so what the STT provider receives and the adapter behavior are untested. Status: partly implemented | Chirp 3/V2 logging: UNVERIFIED. Reference: the V1 data-logging page says "By default, Cloud Speech-to-Text does not log customer audio data or transcripts" [providers.md 3]. Deepgram: `mip_opt_out=true` must be set by the STT adapter (BE-89, not built); opted-out requests are kept only to process |
| Transcript / questions | Gemini prompt | Server side: memory only, TTL 24h max; no content on disk or in logs (BE-85 #8 SessionStore and BE-96 #14 retention test + log allowlist, both merged). UNVERIFIED: removal of transcript content via onEnd (BE-89 / BE-108 not merged); no transcript exists in the server yet. Status: partly implemented | Not used for training without our prior permission or instruction [providers.md 1]. Google logs prompts only if classifiers flag them, up to 90 days, in the selected region; exempt by default if Praneat has a Google Cloud Master Agreement (to check). Frontier models (e.g. Gemini 4 Argon): prompts + responses up to 30 days. Source: providers.md [10] |
| Session Pack (docs from Drive) | Drive API read (provider merged, BE-90 #16, not yet wired into the session flow), then Gemini explicit CachedContent (D21, planned) | Intended: memory only (BE-85 #8 merged for session memory; Drive reader merged (BE-90 #16) but not wired into the session flow; pack removal via onEnd UNVERIFIED (BE-94 / BE-108)). Cache ttl <= 1h and delete on `session.end`: BE-94 PR #17 draft. Status: not merged | Gemini cache ttl <= 1h is the value we request; Google's actual retention / deletion of cached content is UNVERIFIED; not zero-retention by Google's definition. Drive source-file retention: Praneat Workspace admin setting, not Rafael-controlled, UNVERIFIED / not researched (providers.md) |
| Cue | Extension | Server side: cues are not generated or stored yet (brain not merged); the log allowlist (BE-96 #14, merged) drops content fields. UNVERIFIED: the extension side panel (FE-37 #11, not merged). Status: not implemented | n/a |
| Server logs | Cloud Logging | Metadata only: each entry is a fixed event name (`msg`, a code constant) plus allowlisted scalar fields (ids, counts, ms, codes); any other field is dropped and a `droppedCount` is added only when something was dropped (BE-96 #14, merged; `apps/server/src/log.ts`, `log.test.ts`). Status: implemented | Google Cloud. Retention UNVERIFIED: our project's `_Default` log bucket retention not checked (Google's documented default is 30 days; `_Required` audit bucket 400 days, not configurable) |

Processors and regions: Google Workspace / Drive API (reader merged in BE-90 #16 but not yet wired into the session flow, so no pack is read on develop today; it will read the pack with the user's `drive.readonly` token; governed by the Google API Services User Data Policy; whether Praneat's Google agreement/DPA covers Drive is UNVERIFIED, see Q0), Google Cloud (Cloud Run; Vertex Gemini planned, not called by develop yet, asia-southeast1 Singapore, no in-region ML processing guarantee) plus STT: Google Chirp 3 (asia-southeast1 unconfirmed; `us`/`eu` documented) or Deepgram (EU endpoint verified; US UNVERIFIED; no Asia endpoint found). Per provider: Vertex Gemini asia-southeast1 (no Thailand region, so outside Thailand); Drive region UNVERIFIED; Chirp 3 asia-southeast1 UNVERIFIED (`us`/`eu` documented); Deepgram EU (or US, UNVERIFIED).

Audit log (planned, BE-97, not built): session start/end, email hash, error codes, token usage; no audio / transcript / cue content by design. Retention: not decided (UNVERIFIED).

## 4. Questions for the DPO

0. Does Praneat have a Google Cloud Master Agreement (default exemption from abuse-monitoring prompt logging), and does that agreement / the Cloud DPA cover Drive reads? If we choose a Frontier model (e.g. Gemini 4 Argon), prompts + responses are logged up to 30 days: acceptable?

1. Is Singapore / US / EU processing acceptable under PDPA cross-border rules with a DPA, or must processing stay in an ASEAN-only region?
2. Is "does not record" wording acceptable given external STT and Google abuse-monitoring logs? Do we need to request an exception from Google?
3. Is an oral notice sufficient, or is written consent needed per customer?
4. Do Session Pack documents count as personal data when they contain customer names / contacts?
5. Is a Gemini explicit cache of <= 1h acceptable?
6. Which customer segments are excluded (section 2)?

## 5. Proof needed before sending (not yet verified)

- D11 enforcement (no content in logs): BE-85 (#8) and BE-96 retention test + log allowlist (#14) merged; content-removal via onEnd for transcript / pack / cue still needs BE-89, BE-108, BE-94.
- D21 cache deleted on `session.end`: BE-94 (#17) draft, not merged.
- Deepgram `mip_opt_out` / Chirp no-logging config: STT adapters BE-89 not built.
- Cloud Logging retention: check the project's `_Default` bucket setting and pick the BE-97 audit log retention.
- Google written answers on abuse logging and explicit-cache ZDR.
- Praneat's Google agreement / DPA: confirm which one exists and that it covers Drive (UNVERIFIED).
