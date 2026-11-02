# SYNTHETIC deal fixture (placeholder for BE-68)

**SYNTHETIC. Every company, product, number and customer here is invented.** No Praneat or real
customer data. Safe to commit. Replace with the real BD-prepared set (BE-68) when it exists, and do
**not** use eval results from this set for the Go/No-go decision.
- Seller: "Verdant Cloud" (fictional), product "Lumora Desk" (helpdesk SaaS). Prospect: "Siam Kitchen Group".
- `pack/*.md` = fake Drive folder. One file per Drive file (`pricing.pdf.md` = the file `pricing.pdf`),
  one `## <page>` section per page/chunk. Anchor = `[<file name without .md> › <page>]`, same shape as
  `buildPack` (`[pricing.pdf › หน้า 1]`).
- `key.csv` = 20 questions (Thai + English terms) in the `question,answer,anchor` format of
  `src/key.ts`; 17 answerable, 3 with `ไม่มีใน source` (WhatsApp, on-premise, voice/IVR).
- Check: `pnpm --filter @rafael/eval test` (synthetic.test.ts: anchors exist in pack, fake runner passes).
- Fake-runner run: `pnpm --filter @rafael/eval eval --key fixtures/synthetic-deal/key.csv`.
- No audio here (D11). TTS audio generation is not done yet: Cloud TTS API is not enabled in rafael-512903.
- Reports (`--out`) and cue dumps of a REAL deal must never be stored in the repo (D11): `--out` / `--dump` refuse repo paths; stdout is unrestricted.
