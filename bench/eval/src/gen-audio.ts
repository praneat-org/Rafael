// SYNTHETIC audio stand-in for BE-72 (BE-121). Fictional fixture -> Gemini TTS (Vertex, ADC) -> 3 wav variants.
// D11: output only outside the repo. Results from this audio must NEVER drive Go/No-go.
// usage: GOOGLE_CLOUD_PROJECT=... pnpm --filter @rafael/eval gen:audio --out /abs/path/outside/repo
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import {
  assemble,
  bandLimit,
  encodeWav,
  makeNoise,
  minQuestionGap,
  mixAtSnr,
  resample,
  SAMPLE_RATE,
  type Segment,
  toPcm16,
} from './audio.js';
import { parseKey } from './key.js';
import { assertOutsideRepo } from './outside.js';

// Fictional pitch for "Lumora Desk". Deliberately generic: no concrete numbers, so it can't leak/contradict key.csv answers.
const NARRATION = [
  'สวัสดีครับทุกท่าน ขอบคุณที่สละเวลามาร่วมประชุมวันนี้ ผมชื่อกฤษณะ ดูแลทีม solution จาก Lumora Desk วันนี้ผมจะพาทุกท่านดูภาพรวมของแพลตฟอร์ม help desk ที่ออกแบบมาสำหรับทีมซัพพอร์ตภาษาไทยโดยเฉพาะ และเล่าว่าองค์กรของคุณจะนำไปใช้งานจริงได้อย่างไร',
  'ก่อนอื่นขอเล่าถึงปัญหาที่เราได้ยินบ่อยที่สุดจากลูกค้าในไทย ทีมซัพพอร์ตต้องรับเรื่องจากหลายช่องทางพร้อมกัน ทั้งอีเมล แชต และ social media ข้อมูลกระจัดกระจาย agent ต้องสลับหน้าจอไปมา ทำให้ตอบช้า และหัวหน้าทีมก็มองไม่เห็นภาพรวมของคิวงานแบบเรียลไทม์',
  'Lumora Desk รวมทุกช่องทางไว้ใน inbox เดียว ทุก ticket จะถูกจัดลำดับความสำคัญอัตโนมัติ มี routing rule ที่ตั้งค่าได้เองโดยไม่ต้องเขียนโค้ด เช่น ส่งเรื่องเกี่ยวกับการเงินไปทีมบัญชี หรือส่งลูกค้า VIP ไปหา agent ที่มีประสบการณ์มากที่สุด',
  'ในมุมของ agent เรามี unified workspace ที่แสดงประวัติการสนทนาทั้งหมดของลูกค้าคนนั้นไว้ในหน้าเดียว มี macro สำหรับคำตอบที่ใช้บ่อย และมี keyboard shortcut ให้ทำงานได้เร็วขึ้น ทีมที่ใช้งานมาแล้วบอกว่าเวลาเรียนรู้ระบบสั้นกว่าที่คาดไว้มาก',
  'ส่วนที่ผมอยากให้ดูเป็นพิเศษคือ AI Assist ซึ่งช่วยสรุป ticket ที่ยาวให้เหลือไม่กี่บรรทัด และเสนอร่างคำตอบเป็นภาษาไทยหรืออังกฤษให้ agent ตรวจแก้ก่อนส่ง agent ยังเป็นคนตัดสินใจสุดท้ายเสมอ AI เป็นเพียงผู้ช่วยที่ช่วยลดงานซ้ำซ้อน',
  'เรื่องความปลอดภัยและ compliance เป็นสิ่งที่เราให้ความสำคัญตั้งแต่วันแรก ระบบมี role-based access control มี audit log ของทุกการกระทำ และเราผ่านการตรวจประเมินจากหน่วยงานภายนอกอย่างสม่ำเสมอ เพื่อให้ฝ่าย IT และฝ่ายกฎหมายของคุณมั่นใจได้',
  'ต่อไปคือเรื่องการเชื่อมต่อกับระบบที่คุณใช้อยู่แล้ว เรามี integration สำเร็จรูปกับเครื่องมือยอดนิยม และมี REST API กับ webhook สำหรับระบบภายในขององค์กร ทีม engineer ของเราช่วยดูแลตลอดช่วงติดตั้ง จึงไม่ต้องกังวลว่าจะต้องเริ่มทุกอย่างจากศูนย์',
  'มาดูเรื่อง reporting กันบ้าง ผู้จัดการสามารถดู dashboard ที่แสดง first response time, resolution time และ CSAT แยกตามทีม ตามช่องทาง หรือตาม agent ได้ทันที และตั้งให้ส่ง weekly report เข้าอีเมลทุกเช้าวันจันทร์ เพื่อใช้ประชุมทีมได้เลยโดยไม่ต้องเตรียมสไลด์เอง',
  'สำหรับขั้นตอนการเริ่มต้นใช้งาน เราจะเริ่มจากการประชุม kickoff เพื่อทำความเข้าใจ workflow ปัจจุบันของคุณ จากนั้นย้ายข้อมูลจากระบบเดิม ตั้งค่า routing และ macro แล้วอบรมทีมงาน ก่อน go-live เราจะรัน pilot กับทีมเล็กเพื่อจับปัญหาตั้งแต่เนิ่น ๆ',
  'ลูกค้าหลายรายของเราเป็นธุรกิจที่มีหลายสาขาและมีฤดูกาลขายที่ชัดเจน ซึ่งปริมาณ ticket ขึ้นลงมาก ระบบของเรารองรับการ scale ตามปริมาณงานโดยที่ agent ไม่ต้องรู้สึกถึงความต่าง และหัวหน้าทีมปรับ workload ระหว่างทีมได้จากหน้าจอเดียว',
  'ผมขอพูดถึงเรื่อง support ของเราเองด้วย ทีมงานของเรามี knowledge base ภาษาไทยที่อัปเดตสม่ำเสมอ มี onboarding guide และ video tutorial และถ้าติดปัญหาก็ติดต่อทีม support ได้หลายช่องทาง ทุกเรื่องที่รายงานเข้ามาจะมีเจ้าของรับผิดชอบจนปิดงาน',
  'หลายท่านถามว่าถ้าอยากลองก่อนตัดสินใจทำได้ไหม เรายินดีให้ทดลองใช้งานจริงกับข้อมูลของคุณเอง เพื่อให้ทีมได้ลองเปรียบเทียบกับวิธีทำงานปัจจุบัน แล้วค่อยตัดสินใจร่วมกันว่าแพ็กเกจไหนเหมาะกับขนาดทีมและงบประมาณขององค์กร',
  'สุดท้ายผมอยากสรุปว่า เป้าหมายของ Lumora Desk คือทำให้ทีมซัพพอร์ตตอบลูกค้าได้เร็วขึ้น ทำงานซ้ำซ้อนน้อยลง และมีข้อมูลที่ชัดเจนไว้ตัดสินใจ ขอบคุณทุกท่านที่ตั้งใจฟัง และยินดีตอบทุกคำถามที่ยังค้างอยู่ครับ',
];

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    fixture: {
      type: 'string',
      default: new URL('../fixtures/synthetic-deal', import.meta.url).pathname,
    },
  },
});
if (!values.out) throw new Error('--out <dir outside repo> required');
const out = assertOutsideRepo(values.out, '--out');
const rows = parseKey(readFileSync(join(values.fixture!, 'key.csv'), 'utf8'));

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.TTS_LOCATION ?? 'global',
});
const model = process.env.TTS_MODEL ?? 'gemini-2.5-flash-tts';
let chars = 0;
let calls = 0;

async function synth(text: string, voice: string): Promise<Float32Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });
      const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error('no audio returned');
      calls++;
      chars += text.length;
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000);
      const b = Buffer.from(part.inlineData.data, 'base64');
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~1)));
      return resample(
        Float32Array.from(pcm, (x) => x / 32768),
        rate,
        SAMPLE_RATE,
      );
    } catch (e) {
      const status = (e as { status?: number }).status;
      // 4xx (bad request/auth/quota-config) won't fix itself; 429 can
      if (attempt >= 3 || (status && status >= 400 && status < 500 && status !== 429)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// interleave: narration[i], then a share of the 20 questions (questions spread evenly across gaps)
const segs: Segment[] = [];
let qi = 0;
for (let i = 0; i < NARRATION.length; i++) {
  segs.push({
    kind: 'narration',
    text: NARRATION[i]!,
    audio: await synth(NARRATION[i]!, process.env.TTS_VOICE ?? 'Kore'),
  });
  const upto = Math.round(((i + 1) * rows.length) / NARRATION.length);
  for (; qi < upto; qi++) {
    const text = rows[qi]!.question;
    segs.push({
      kind: 'question',
      id: `q${String(qi + 1).padStart(2, '0')}`,
      text,
      audio: await synth(text, process.env.TTS_QUESTION_VOICE ?? 'Puck'),
    });
  }
}

const { audio, timeline } = assemble(segs);
const variants = {
  quiet: audio,
  noisy: mixAtSnr(audio, makeNoise(audio.length), 10),
  meet: bandLimit(mixAtSnr(audio, makeNoise(audio.length, SAMPLE_RATE, 2), 30)),
};
if (minQuestionGap(timeline) < 8000) throw new Error('questions closer than 8 s apart');
// contract: timeline.questions == key.csv rows, same order, same count (consumers match by position)
if (
  timeline.questions.length !== rows.length ||
  timeline.questions.some((q, i) => q.text !== rows[i]?.question)
)
  throw new Error('timeline does not match key.csv row order');
mkdirSync(out, { recursive: true });
for (const [name, f] of Object.entries(variants))
  writeFileSync(join(out, `${name}.wav`), encodeWav(toPcm16(f)));
writeFileSync(join(out, 'timeline.json'), JSON.stringify(timeline, null, 2));
writeFileSync(join(out, 'reference.txt'), segs.map((s) => s.text).join('\n'));
console.log({
  out,
  seconds: +(audio.length / SAMPLE_RATE).toFixed(1),
  narrationSeconds: +(
    segs.filter((s) => s.kind === 'narration').reduce((n, s) => n + s.audio.length, 0) / SAMPLE_RATE
  ).toFixed(1),
  questions: timeline.questions.length,
  ttsCalls: calls,
  ttsChars: chars,
  model,
});
