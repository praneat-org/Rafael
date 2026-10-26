import { AudioPipeline, TARGET_RATE } from './pcm';

export type CaptureOpts = { tab: boolean; mic: boolean };
export type CaptureError = 'mic-permission' | 'tab-capture';
export type CaptureHandle = { pause(): void; resume(): void; stop(): void };

export class CaptureFailed extends Error {
  constructor(public reason: CaptureError) {
    super(reason);
  }
}

/** Needs the real browser (AudioContext / getUserMedia): verified by hand, see the PR. */
export async function startCapture(
  opts: CaptureOpts,
  tabStreamId: string | null,
  sendAudio: (f: Uint8Array) => void,
  onLevel: (rms: number) => void,
): Promise<CaptureHandle> {
  const streams: MediaStream[] = [];
  let ctx: AudioContext | null = null;
  const stop = () => {
    for (const s of streams) for (const t of s.getTracks()) t.stop();
    void ctx?.close();
  };
  try {
    ctx = new AudioContext({ sampleRate: TARGET_RATE }); // Chrome resamples tab / mic to 16 kHz
    await ctx.audioWorklet.addModule(browser.runtime.getURL('/pcm-worklet.js'));
    const pipeline = new AudioPipeline({ sendAudio }, onLevel, ctx.sampleRate);
    // mono sink: multiple sources connected to one input are summed, then downmixed
    const node = new AudioWorkletNode(ctx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => pipeline.push(e.data);

    if (opts.tab) {
      if (!tabStreamId) throw new CaptureFailed('tab-capture');
      const tab = await navigator.mediaDevices
        .getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: tabStreamId } },
          video: false,
        } as MediaStreamConstraints)
        .catch(() => {
          throw new CaptureFailed('tab-capture');
        });
      streams.push(tab);
      const src = ctx.createMediaStreamSource(tab);
      src.connect(ctx.destination); // capturing mutes the tab: route it back so the user still hears the meeting
      src.connect(node);
    }
    if (opts.mic) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
        throw new CaptureFailed('mic-permission');
      });
      streams.push(mic);
      ctx.createMediaStreamSource(mic).connect(node); // never to destination: no echo of own voice
    }
    await ctx.resume();
    return { pause: () => pipeline.pause(), resume: () => pipeline.resume(), stop };
  } catch (e) {
    stop();
    throw e;
  }
}
