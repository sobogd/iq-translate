// Browser WAV recorder: captures mic as raw PCM, encodes 16 kHz mono WAV —
// the format whisper.cpp wants (unlike MediaRecorder's webm/opus, which the
// engine would have to be taught to decode).

const TARGET_RATE = 16000;

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private inputRate = 48000;

  async start() {
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext();
    this.inputRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(ch));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  async stop(): Promise<Blob> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();

    const merged = this.merge(this.chunks);
    const down = this.downsample(merged, this.inputRate, TARGET_RATE);
    return this.encodeWav(down, TARGET_RATE);
  }

  private merge(chunks: Float32Array[]): Float32Array {
    const len = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(len);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  private downsample(data: Float32Array, from: number, to: number): Float32Array {
    if (to >= from) return data;
    const ratio = from / to;
    const newLen = Math.round(data.length / ratio);
    const out = new Float32Array(newLen);
    let pos = 0;
    for (let i = 0; i < newLen; i++) {
      const next = Math.round((i + 1) * ratio);
      let sum = 0;
      let cnt = 0;
      for (let j = Math.round(i * ratio); j < next && j < data.length; j++) {
        sum += data[j];
        cnt++;
      }
      out[i] = cnt ? sum / cnt : 0;
      pos = next;
    }
    void pos;
    return out;
  }

  private encodeWav(data: Float32Array, rate: number): Blob {
    const buffer = new ArrayBuffer(44 + data.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + data.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, data.length * 2, true);
    let off = 44;
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }
}
