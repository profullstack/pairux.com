// Generated from @profullstack/live-translate TAP_SOURCE: the desktop CSP
// (script-src 'self') refuses the package's blob: worklet, so it ships as a file.
// The render thread copies small mono blocks. All networking stays off it.
class LiveTranslateAudioTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(2048);
    this.at = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.block[this.at++] = value / channels.length;
      if (this.at === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(2048);
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor('live-translate-audio-tap', LiveTranslateAudioTap);
