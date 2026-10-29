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
};

export function createGeminiSttProvider(o: GeminiSttOptions): SttProvider {
  const flushMs = o.flushTimeoutMs ?? 2000;
  const maxQueued = o.maxQueuedFrames ?? 100;
  return {
    start(hints, h): SttStream {
      let session: LiveSessionLike | undefined;
      let queue: Int16Array[] | null = [];
      let interim = ''; // latest partial of the open segment; flushed as final on close if no final came
      let closing = false;
      let dead = false;
      let closeP: Promise<void> | undefined;
      let gotFinal: (() => void) | undefined; // wakes close()
      const fail = () => {
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
        const speaker = c?.inputTranscription?.speakerLabel;
        if (c?.inputTranscription?.text) {
          interim = '';
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
        closing = true; // from here our own socket close is not an error
        await ready;
        if (session && !dead && interim) {
          const waitFinal = new Promise<void>((r) => {
            gotFinal = r;
            setTimeout(r, flushMs).unref();
          });
          try {
            session.sendRealtimeInput({ audioStreamEnd: true });
            await waitFinal;
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
    silenceMs: Number(env.STT_SILENCE_MS) || 300, // measured: default VAD ~1.4-2.8 s to final, 300 ~1.0 s, 100 ~0.8 s
    connect: ({ model, config, callbacks }) =>
      ai.live.connect({ model, config, callbacks } as any) as Promise<LiveSessionLike>,
  });
}
