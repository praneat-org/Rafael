import { GoogleGenAI, Modality } from '@google/genai';
import type { SttHandlers, SttProvider, SttStream } from './provider.js';

// BE-89: SttProvider on Gemini Live transcription via Vertex (D22, ADC, no keys).
// D11: never log or keep audio/text; errors are surfaced as onError() with no SDK error attached.

/** Slice of the SDK's live session we use, so tests can fake it without network. */
export interface LiveSessionLike {
  sendRealtimeInput(p: {
    audio?: { data: string; mimeType: string };
    audioStreamEnd?: boolean;
  }): void;
  close(): void;
}
export type LiveConnect = (p: {
  model: string;
  config: Record<string, unknown>;
  callbacks: {
    onmessage(m: any): void;
    onerror(e: unknown): void;
    onclose(e: unknown): void;
  };
}) => Promise<LiveSessionLike>;

export type GeminiSttOptions = {
  connect: LiveConnect;
  model: string;
  /** how long close() waits for the last final after audioStreamEnd */
  flushTimeoutMs?: number;
  /** frames buffered while the session is still connecting (100 ms each); oldest dropped */
  maxQueuedFrames?: number;
  /** end-of-speech silence the server waits before finalising (VAD); unset = model default */
  silenceMs?: number;
  /** BE-116: speech pushed but no partial/final within this many ms -> onError (rolling reopens). 0 = off */
  watchdogMs?: number;
};

// ponytail: peak-amplitude gate (~3% FS) so idle/near-silent mic frames don't arm the watchdog
const SPEECH_PEAK = 1000;
const isSpeech = (pcm: Int16Array) => {
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i] ?? 0) > SPEECH_PEAK) return true;
  return false;
};

export function createGeminiSttProvider(o: GeminiSttOptions): SttProvider {
  const flushMs = o.flushTimeoutMs ?? 2000;
  const maxQueued = o.maxQueuedFrames ?? 100;
  const watchMs = o.watchdogMs ?? 8000;
  return {
    start(hints, h): SttStream {
      let session: LiveSessionLike | undefined;
      let queue: Int16Array[] | null = [];
      let interim = ''; // latest partial of the open segment; flushed as final on close if no final came
      let pushed = false; // audio sent since the last final: a final may still be in flight even with no partial yet
      let closing = false;
      let dead = false;
      let closeP: Promise<void> | undefined;
      let gotFinal: (() => void) | undefined; // wakes close()
      let watch: NodeJS.Timeout | undefined;
      const disarm = () => {
        clearTimeout(watch);
        watch = undefined;
      };
      const fail = () => {
        disarm();
        if (dead || closing) return;
        dead = true;
        h.onError();
      };
      const send = (s: LiveSessionLike, pcm: Int16Array) =>
        s.sendRealtimeInput({
          audio: {
            data: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      const ready = o
        .connect({
          model: o.model,
          config: {
            responseModalities: [Modality.TEXT],
            ...(o.silenceMs
              ? {
                  realtimeInputConfig: {
                    automaticActivityDetection: { silenceDurationMs: o.silenceMs },
                  },
                }
              : {}),
            inputAudioTranscription: hints.length ? { customVocabulary: [...hints] } : {},
          },
          callbacks: {
            onmessage: (m) => onMessage(m, h),
            onerror: fail,
            onclose: fail, // our own close() sets `closing` first, so this only fires on stream death
          },
        })
        .then((s) => {
          if (dead) return s.close();
          session = s;
          for (const f of queue ?? []) send(s, f);
          queue = null;
        })
        .catch(fail);

      function onMessage(m: any, hh: SttHandlers) {
        const c = m?.serverContent;
        if (c?.inputTranscription?.text || c?.interimInputTranscription?.text) disarm();
        const speaker = c?.inputTranscription?.speakerLabel;
        if (c?.inputTranscription?.text) {
          interim = '';
          pushed = false;
          hh.onFinal(c.inputTranscription.text, speaker);
          gotFinal?.();
        } else if (c?.interimInputTranscription?.text) {
          interim = c.interimInputTranscription.text;
          hh.onPartial(interim, c.interimInputTranscription.speakerLabel);
        }
      }

      return {
        push(pcm) {
          if (dead || closing) return;
          pushed = true;
          if (watchMs && !watch && isSpeech(pcm)) {
            watch = setTimeout(fail, watchMs);
            watch.unref();
          }
          if (session) return send(session, pcm);
          queue?.push(pcm);
          if (queue && queue.length > maxQueued) queue.shift();
        },
        close() {
          closeP ??= doClose();
          return closeP;
        },
      };

      async function doClose() {
        disarm();
        closing = true; // from here our own socket close is not an error
        await ready;
        if (session && !dead) {
          // ponytail: no partial yet but audio pushed -> wait <= 500 ms (rollover latency ceiling); partial open -> flushMs; idle -> no wait
          const waitMs = interim ? flushMs : pushed ? Math.min(flushMs, 500) : 0;
          try {
            session.sendRealtimeInput({ audioStreamEnd: true });
            if (waitMs)
              await new Promise<void>((r) => {
                gotFinal = r;
                setTimeout(r, waitMs).unref();
              });
          } catch {
            // socket already gone: fall through to the interim flush
          }
        }
        if (interim) h.onFinal(interim); // no final arrived in time: keep the words rather than drop them
        interim = '';
        try {
          session?.close();
        } catch {
          // already closed
        }
      }
    },
  };
}

/** Real SDK over Vertex. Location is its own env: the transcribe models only exist at `global`. */
export function createGeminiStt(env: Record<string, string | undefined>): SttProvider | undefined {
  const model = env.STT_MODEL;
  const project = env.GOOGLE_CLOUD_PROJECT;
  if (!model) return undefined;
  if (!project) throw new Error('STT_MODEL is set but GOOGLE_CLOUD_PROJECT is not');
  const ai = new GoogleGenAI({ vertexai: true, project, location: env.STT_LOCATION || 'global' });
  return createGeminiSttProvider({
    model,
    watchdogMs: env.STT_WATCHDOG_MS ? Number(env.STT_WATCHDOG_MS) : undefined,
    silenceMs: Number(env.STT_SILENCE_MS) || 300, // measured: default VAD ~1.4-2.8 s to final, 300 ~1.0 s, 100 ~0.8 s
    connect: ({ model, config, callbacks }) =>
      ai.live.connect({ model, config, callbacks } as any) as Promise<LiveSessionLike>,
  });
}
