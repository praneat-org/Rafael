import { AudioPipeline, TARGET_RATE } from './pcm';

export type CaptureOpts = { tab: boolean; mic: boolean };
export type CaptureError = 'mic-permission' | 'mic-ended' | 'tab-capture' | 'tab-no-audio';
export type CaptureHandle = { pause(): void; resume(): void; stop(): void };

export class CaptureFailed extends Error {
  constructor(public reason: CaptureError) {
    super(reason);
  }
}

/** What differs per host: the extension (tabCapture stream id) vs the web app (getDisplayMedia). */
export type CaptureEnv = {
  workletUrl: string;
  /** the tab's audio-only stream; throws CaptureFailed */
  tabStream: () => Promise<MediaStream>;
  /** extension: capturing mutes the tab, so route it back. Web: the tab keeps playing, routing back would echo */
  monitorTab: boolean;
};
export type CaptureSinks = {
  sendAudio: (f: Uint8Array) => void;
  onLevel: (rms: number) => void;
  /** a track ended on its own (user stopped sharing / unplugged the mic) */
  onLost?: (reason: CaptureError) => void;
};

/** Needs the real browser (AudioContext / getUserMedia): verified by hand, see the PR. */
export async function startCapture(
  opts: CaptureOpts,
  env: CaptureEnv,
  sinks: CaptureSinks,
): Promise<CaptureHandle> {
  const { sendAudio, onLevel, onLost } = sinks;
  const streams: MediaStream[] = [];
  let ctx: AudioContext | null = null;
  const stop = () => {
    for (const s of streams) for (const t of s.getTracks()) t.stop();
    void ctx?.close();
  };
  try {
    ctx = new AudioContext({ sampleRate: TARGET_RATE }); // Chrome resamples tab / mic to 16 kHz
    await ctx.audioWorklet.addModule(env.workletUrl);
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
      const tab = await env.tabStream();
      streams.push(tab);
      for (const t of tab.getAudioTracks()) {
        t.addEventListener('ended', () => onLost?.('tab-capture'));
      }
      const src = ctx.createMediaStreamSource(tab);
      if (env.monitorTab) src.connect(ctx.destination);
      src.connect(node);
    }
    if (opts.mic) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
        throw new CaptureFailed('mic-permission');
      });
      streams.push(mic);
      for (const t of mic.getAudioTracks()) {
        t.addEventListener('ended', () => onLost?.('mic-ended'));
      }
      ctx.createMediaStreamSource(mic).connect(node); // never to destination: no echo of own voice
    }
    await ctx.resume();
    return { pause: () => pipeline.pause(), resume: () => pipeline.resume(), stop };
  } catch (e) {
    stop();
    throw e;
  }
}

/** Extension: tab audio from a chrome.tabCapture stream id (expires in seconds, used right away). */
export async function extensionTabStream(streamId: string | null): Promise<MediaStream> {
  if (!streamId) throw new CaptureFailed('tab-capture');
  return navigator.mediaDevices
    .getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    } as MediaStreamConstraints)
    .catch(() => {
      throw new CaptureFailed('tab-capture');
    });
}

/**
 * Web: the user picks a tab and ticks "share tab audio". Video is not needed: stop it.
 * No audio track (box not ticked, or a window / screen was picked) -> 'tab-no-audio'.
 */
export async function displayMediaAudio(
  md: Pick<MediaDevices, 'getDisplayMedia'>,
): Promise<MediaStream> {
  const s = await md.getDisplayMedia({ video: true, audio: true }).catch(() => {
    throw new CaptureFailed('tab-capture'); // cancelled / blocked
  });
  for (const v of s.getVideoTracks()) {
    v.stop();
    s.removeTrack(v);
  }
  if (s.getAudioTracks().length === 0) {
    for (const t of s.getTracks()) t.stop();
    throw new CaptureFailed('tab-no-audio');
  }
  return s;
}
