// AudioWorklet: hands the (already mono-mixed) 128-sample blocks to the offscreen document,
// which frames them. No state here, nothing is stored (D11).
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) {
      const copy = ch.slice();
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
