/**
 * Decodes base64 string to Uint8Array (Manual implementation as per Gemini API guidelines)
 */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes Uint8Array to base64 string (Manual implementation as per Gemini API guidelines)
 */
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes raw PCM data into an AudioBuffer.
 * NOTE: This is NOT the native AudioContext.decodeAudioData (which is for full files like mp3).
 * This is a manual PCM-to-buffer conversion.
 */
export async function decodeAudioData(
  base64Data: string,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const data = decode(base64Data);
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Helper to convert Float32Array (browser audio) to base64 PCM for Gemini API
 */
export function float32ToPcmBase64(data: Float32Array): string {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return encode(new Uint8Array(int16.buffer));
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private activeBuffer: AudioBuffer | null = null;
  private onEndedCallback: (() => void) | null = null;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000,
    });
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
  }

  get context() {
    return this.ctx;
  }

  async decode(base64Data: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    return decodeAudioData(base64Data, this.ctx);
  }

  async load(base64Data: string): Promise<number> {
    if (!this.ctx) return 0;
    const buffer = await decodeAudioData(base64Data, this.ctx);
    this.activeBuffer = buffer;
    return buffer.duration;
  }

  playBuffer(offset: number = 0, onEnded?: () => void) {
    if (!this.ctx || !this.activeBuffer) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.stop(false);

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.activeBuffer;
    this.source.connect(this.gainNode!);
    
    this.onEndedCallback = onEnded || null;
    this.source.onended = () => {
      if (this.onEndedCallback) this.onEndedCallback();
    };

    this.source.start(0, offset);
  }

  async play(base64Data: string, onEnded?: () => void): Promise<number> {
    const duration = await this.load(base64Data);
    this.playBuffer(0, onEnded);
    return duration;
  }

  stop(clearBuffer: boolean = true) {
    if (this.source) {
      try {
        this.source.stop();
        this.source.onended = null;
      } catch (e) {}
      this.source = null;
    }
    if (clearBuffer) {
      this.activeBuffer = null;
      this.onEndedCallback = null;
    }
  }
}

export const audioPlayer = new AudioPlayer();