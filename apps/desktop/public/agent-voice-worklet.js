class PairuxVoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    output?.fill(0);

    const input = inputs[0]?.[0];
    if (input?.length) {
      const samples = input.slice();
      this.port.postMessage(samples, [samples.buffer]);
    }
    return true;
  }
}

registerProcessor('pairux-voice-capture', PairuxVoiceCaptureProcessor);
