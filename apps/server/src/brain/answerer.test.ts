import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from '../session/store.js';
import {
  type AnswererLog,
  buildPrefix,
  type CueOut,
  createAnswerer,
  type PackIndex,
} from './answerer.js';
import { loadBrainConfig } from './config.js';
import type { LlmClient, LlmRequest } from './llm.js';

const config = loadBrainConfig({ DETECTOR_MODEL: 'det', ANSWERER_MODEL: 'ans-model' });
const pack: PackIndex = [
  {
    anchor: '[deck.pdf › หน้า 3]',
    file: 'deck.pdf',
    fileId: 'f1',
    locator: 'หน้า 3',
    text: 'SECRET-PACK-TEXT price 100',
  },
  {
    anchor: '[faq.docx › section SLA]',
    file: 'faq.docx',
    fileId: 'f2',
    locator: 'section SLA',
    text: 'uptime 99.9',
  },
];
const A1 = '[deck.pdf › หน้า 3]';
const A2 = '[faq.docx › section SLA]';

type Script = { deltas: string[]; fail?: boolean };
function fake(scripts: Script[]) {
  const calls: string[] = [];
  const reqs: LlmRequest[] = [];
  let caches = 0;
  const live = new Set<string>();
  const llm: LlmClient = {
    async complete() {
      calls.push('complete');
      return { text: '' };
    },
    async stream(req, onText) {
      calls.push('stream');
      reqs.push(req);
      const s = scripts.shift() ?? { deltas: [] };
      for (const d of s.deltas) onText(d);
      if (s.fail) throw new Error('boom SECRET-PACK-TEXT');
      return { text: s.deltas.join(''), inputTokens: 100, outputTokens: 20, cacheReadTokens: 90 };
    },
    async createCache() {
      calls.push('create');
      const h = `cache-${++caches}`;
      live.add(h);
      return h;
    },
    async renewCache() {
      calls.push('renew');
    },
    async deleteCache(h) {
      calls.push('delete');
      live.delete(h);
    },
  };
  return { llm, calls, reqs, live };
}

async function run(scripts: Script[], q = 'ราคาเท่าไร') {
  const f = fake(scripts);
  const logs: AnswererLog[] = [];
  let t = 0;
  const a = createAnswerer({ llm: f.llm, config, pack, now: () => t, log: (e) => logs.push(e) });
  await a.ready();
  const cues: CueOut[] = [];
  const final = await a.answer('c1', q, (c) => cues.push(c));
  return { ...f, a, logs, cues, final, setNow: (x: number) => (t = x) };
}

describe('answerer anchor check (D10)', () => {
  it('keeps verified bullets; sources come only from verified anchors', async () => {
    const r = await run([{ deltas: [`- ราคา 100 บาท ${A1}\n- uptime 99.9 ${A2}`] }]);
    expect(r.final.notFound).toBe(false);
    expect(r.final.partial).toBe(false);
    expect(r.final.bullets).toEqual([`ราคา 100 บาท ${A1}`, `uptime 99.9 ${A2}`]);
    expect(r.final.sources.map((s) => s.fileId)).toEqual(['f1', 'f2']);
  });

  it('drops a bullet whose anchor is not in the pack', async () => {
    const r = await run([
      { deltas: [`- ราคา 100 ${A1}\n- ปลอม [deck.pdf › หน้า 99]\n- ปลอม2 [ghost.pdf › หน้า 3]`] },
    ]);
    expect(r.final.bullets).toEqual([`ราคา 100 ${A1}`]);
    expect(r.final.sources).toHaveLength(1);
  });

  it('drops a bullet with no anchor or a half-correct anchor (right file, wrong page)', async () => {
    const r = await run([
      {
        deltas: [
          `- no anchor here\n- half [deck.pdf › หน้า 4]\n- anchor in the middle ${A1} then text`,
        ],
      },
    ]);
    expect(r.final.bullets).toEqual([]);
    expect(r.final.notFound).toBe(true);
  });

  it('no bullet left -> notFound with empty bullets and sources', async () => {
    const r = await run([{ deltas: ['- x [nope › 1]'] }]);
    expect(r.final).toMatchObject({ notFound: true, bullets: [], sources: [], partial: false });
  });

  it('NOT_FOUND from the model -> notFound', async () => {
    const r = await run([{ deltas: ['NOT_FOUND'] }]);
    expect(r.final).toMatchObject({ notFound: true, bullets: [], sources: [] });
  });

  it('notFound=false always has sources (protocol rule)', async () => {
    const r = await run([{ deltas: [`- a ${A1}`] }]);
    for (const c of [...r.cues, r.final])
      if (!c.notFound) expect(c.sources.length).toBeGreaterThan(0);
  });
});

describe('answerer format limits', () => {
  it('keeps at most 3 bullets', async () => {
    const line = (n: number) => `- ข้อ${n} ${A1}\n`;
    const r = await run([{ deltas: [line(1) + line(2) + line(3) + line(4) + line(5)] }]);
    expect(r.final.bullets).toHaveLength(3);
  });

  it('drops a bullet over 15 words (Thai segmented by Intl.Segmenter)', async () => {
    const long = Array.from({ length: 16 }, (_, i) => `word${i}`).join(' ');
    const ok = Array.from({ length: 15 }, (_, i) => `word${i}`).join(' ');
    const r = await run([{ deltas: [`- ${long} ${A1}\n- ${ok} ${A2}`] }]);
    expect(r.final.bullets).toEqual([`${ok} ${A2}`]);
    const thai = await run([
      {
        deltas: [
          `- ${'ระบบรองรับผู้ใช้พร้อมกันหลายคนและมีความเสถียรสูงมากในทุกสถานการณ์การใช้งานจริงของลูกค้าองค์กรขนาดใหญ่'} ${A1}`,
        ],
      },
    ]);
    expect(thai.final.bullets).toEqual([]);
  });
});

describe('answerer streaming', () => {
  it('emits a partial cue only for complete verified bullets, never a half anchor', async () => {
    const r = await run([
      {
        deltas: [
          '- ราคา 100 [deck',
          '.pdf › หน้า 3]',
          '\n- uptime ',
          '99.9 [faq.docx › section SLA]',
        ],
      },
    ]);
    expect(r.cues.map((c) => [c.partial, c.bullets.length])).toEqual([
      [true, 1],
      [true, 2],
      [false, 2],
    ]);
    for (const c of r.cues) for (const b of c.bullets) expect(b).toMatch(/\[[^\]]+ › [^\]]+\]$/);
  });

  it('a bullet with a fake anchor never produces a partial cue', async () => {
    const r = await run([{ deltas: ['- bad [ghost › 1]\n'] }]);
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0]?.partial).toBe(false);
  });

  it('stream error mid-answer keeps verified bullets, discards the unfinished line', async () => {
    const r = await run([{ deltas: [`- ok ${A1}\n- half [faq.docx › sec`], fail: true }]);
    expect(r.final.bullets).toEqual([`ok ${A1}`]);
    expect(r.logs[0]?.outcome).toBe('error');
  });
});

describe('answerer cache (D21) + prompt', () => {
  it('cache prefix = rules + pack, identical across questions; question only in user', async () => {
    const r = await run([{ deltas: ['NOT_FOUND'] }, { deltas: ['NOT_FOUND'] }], 'คำถามแรก');
    await r.a.answer('c2', 'คำถามสอง', () => {});
    expect(r.reqs[0]?.system).toBe(buildPrefix(pack));
    expect(r.reqs[1]?.system).toBe(r.reqs[0]?.system);
    expect(r.reqs.map((q) => q.user)).toEqual(['คำถามแรก', 'คำถามสอง']);
    expect(r.reqs[0]?.system).not.toContain('คำถาม');
    expect(r.reqs[0]?.cache).toBe('cache-1');
    expect(r.reqs[0]?.model).toBe('ans-model');
    expect(r.calls.filter((c) => c === 'create')).toHaveLength(1);
  });

  it('renews the cache after half the ttl', async () => {
    const r = await run([{ deltas: [] }, { deltas: [] }]);
    r.setNow(1_000);
    await r.a.answer('c2', 'q', () => {});
    expect(r.calls).not.toContain('renew');
    r.setNow(config.answerer.cacheTtlSeconds * 500 + 1);
    await r.a.answer('c3', 'q', () => {});
    expect(r.calls).toContain('renew');
  });

  it('refresh pack deletes the old cache and creates a new one', async () => {
    const r = await run([{ deltas: [] }]);
    await r.a.refreshPack(pack.slice(0, 1));
    expect([...r.live]).toEqual(['cache-2']);
  });

  it('dispose deletes the cache; store.end triggers it via onEnd', async () => {
    const r = await run([]);
    const store = new MemorySessionStore();
    const s = store.create('a@praneat.com', 'p');
    s.onEnd = () => r.a.dispose();
    expect(r.live.size).toBe(1);
    store.end(s.id);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.live.size).toBe(0);
  });

  it('works without a cache when creation fails (inline prefix)', async () => {
    const f = fake([{ deltas: [`- a ${A1}`] }]);
    f.llm.createCache = async () => {
      throw new Error('too small');
    };
    const a = createAnswerer({ llm: f.llm, config, pack });
    await a.ready();
    const out = await a.answer('c', 'q', () => {});
    expect(f.reqs[0]?.cache).toBeUndefined();
    expect(out.bullets).toHaveLength(1);
  });

  it('requires ANSWERER_MODEL from config', () => {
    const c = loadBrainConfig({ DETECTOR_MODEL: 'd' });
    expect(() => createAnswerer({ llm: fake([]).llm, config: c, pack })).toThrow();
  });
});

describe('answerer log (D11)', () => {
  it('logs stage numbers + usage, never question / answer / pack text', async () => {
    const r = await run([{ deltas: [`- ราคา 100 ${A1}`] }], 'คำถามลับ');
    const l = r.logs[0];
    expect(l).toMatchObject({
      stage: 'answerer',
      model: 'ans-model',
      bullets: 1,
      outcome: 'answered',
      cached: true,
      inputTokens: 100,
      cacheReadTokens: 90,
      outputTokens: 20,
    });
    expect(l?.firstTokenMs).toBeTypeOf('number');
    const s = JSON.stringify(l);
    for (const secret of ['คำถามลับ', 'ราคา', 'SECRET-PACK-TEXT', 'deck.pdf'])
      expect(s).not.toContain(secret);
  });
});
