// Synthesizes fictional Thai sales-call clips with Gemini TTS (Vertex, ADC). D11: output goes ONLY to STT_AUDIO_DIR
// (default ./.stt-audio, gitignored): <name>.pcm (16 kHz s16le mono) + <name>.txt (script). Never commit them.
// usage: GOOGLE_CLOUD_PROJECT=... pnpm --filter server gen:stt-audio
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';

const dir = process.env.STT_AUDIO_DIR ?? '.stt-audio';
const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.TTS_LOCATION ?? 'global',
});
const model = process.env.TTS_MODEL ?? 'gemini-2.5-flash-tts';

// each clip = list of paragraphs (one TTS call each, joined with 0.5 s silence). All fictional.
const clips: Record<string, string[]> = {
  'q-price': ['ราคาpackage enterprise เท่าไหร่ครับ'],
  'q-integration': [
    'ระบบนี้เชื่อมต่อกับ Salesforce และ Google Workspace ได้ไหมคะ แล้วต้องใช้เวลา onboarding กี่สัปดาห์',
  ],
  'pitch-short': [
    'สวัสดีครับ วันนี้ผมจะมาแนะนำแพลตฟอร์ม Nimbus Analytics ซึ่งช่วยให้ทีมขายเห็น pipeline แบบเรียลไทม์ ลดเวลาทำรายงานลงได้ครึ่งหนึ่ง',
  ],
  'q-security': ['ข้อมูลลูกค้าของเราเก็บอยู่ที่ไหนครับ แล้วมี SSO กับ audit log ไหม'],
  long: [
    'สวัสดีครับทุกท่าน ขอบคุณที่สละเวลามาร่วมประชุมวันนี้ ผมชื่อสมชาย จากบริษัท Nimbus Analytics วันนี้เราจะคุยกันเรื่องการนำแพลตฟอร์มของเราไปใช้กับทีมขายของคุณ',
    'ปัญหาที่เราได้ยินบ่อยที่สุดคือทีมขายต้องเสียเวลาหลายชั่วโมงต่อสัปดาห์ไปกับการทำรายงานด้วยมือ ข้อมูลกระจายอยู่ในหลายระบบ ทั้ง CRM อีเมล และสเปรดชีต ทำให้ผู้จัดการมองไม่เห็นภาพรวมของ pipeline',
    'Nimbus Analytics ดึงข้อมูลจากทุกแหล่งมารวมไว้ใน dashboard เดียว และมี forecast ที่คำนวณอัตโนมัติทุกคืน ทีมของคุณจะเห็นดีลที่เสี่ยงหลุดก่อนสิ้นไตรมาสได้ล่วงหน้า',
    'ทีนี้ผมขอเปิดให้ถามคำถามได้เลยนะครับ ราคาpackage enterprise เท่าไหร่ครับ แล้วถ้าเรามีผู้ใช้สองร้อยคน จะได้ส่วนลดตามปริมาณไหม',
    'เรื่องความปลอดภัย เราใช้การเข้ารหัสทั้งตอนส่งและตอนเก็บข้อมูล รองรับ SSO ผ่าน Google และ Microsoft และมี audit log ที่เก็บย้อนหลังหนึ่งปี',
    'ขั้นตอน onboarding ปกติใช้เวลาประมาณสามสัปดาห์ สัปดาห์แรกเชื่อมต่อระบบ สัปดาห์ที่สองนำเข้าข้อมูลและตั้งค่า dashboard สัปดาห์ที่สามอบรมทีมงานและเริ่มใช้งานจริง',
    'ในส่วนของการรายงาน ผู้จัดการสามารถตั้งค่า weekly digest ส่งเข้าอีเมลทุกเช้าวันจันทร์ สรุปดีลที่เคลื่อนไหว ดีลที่หยุดนิ่งเกินสิบสี่วัน และกิจกรรมของทีมขายแต่ละคน โดยไม่ต้องเปิดเข้าไปดูใน dashboard',
    'อีกจุดที่ลูกค้าหลายรายชอบคือ conversation insights ระบบจะวิเคราะห์บันทึกการโทรและอีเมล แล้วแจ้งเตือนเมื่อคู่แข่งถูกพูดถึง หรือเมื่อลูกค้าเริ่มถามเรื่องราคาและเงื่อนไขสัญญา เพื่อให้ทีมขายเตรียมคำตอบได้ทัน',
    'ส่วนเรื่องการเชื่อมต่อ เรามี connector สำเร็จรูปสำหรับ Salesforce HubSpot และ Google Workspace รวมถึง API แบบ REST สำหรับระบบภายในของคุณ ซึ่งทีม engineer ของเราช่วยดูแลตลอดช่วง onboarding ได้เลยครับ',
    'ถ้ามีคำถามเพิ่มเติม ยินดีนัดคุยอีกรอบกับทีม solution architect ของเราได้เลยครับ ขอบคุณมากครับ',
  ],
};

const SPEECH = {
  voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.TTS_VOICE ?? 'Kore' } },
};

async function synth(text: string): Promise<Int16Array> {
  const r = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: { responseModalities: ['AUDIO'], speechConfig: SPEECH },
  });
  const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error('no audio returned');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000);
  const b = Buffer.from(part.inlineData.data, 'base64');
  const src = new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
  // linear resample to 16 kHz
  const out = new Int16Array(Math.floor((src.length * 16000) / rate));
  for (let i = 0; i < out.length; i++) {
    const p = (i * rate) / 16000;
    const k = Math.floor(p);
    out[i] = src[k]! + ((src[k + 1] ?? src[k]!) - src[k]!) * (p - k);
  }
  return out;
}

mkdirSync(dir, { recursive: true });
for (const [name, paras] of Object.entries(clips)) {
  const parts: Int16Array[] = [];
  for (const p of paras) parts.push(await synth(p), new Int16Array(8000));
  const pcm = new Int16Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) {
    pcm.set(x, o);
    o += x.length;
  }
  writeFileSync(join(dir, `${name}.pcm`), Buffer.from(pcm.buffer));
  writeFileSync(join(dir, `${name}.txt`), paras.join('\n'));
  console.log({ name, seconds: +(pcm.length / 16000).toFixed(1) });
}
