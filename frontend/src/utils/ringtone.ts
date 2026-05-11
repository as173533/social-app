export class RingtonePlayer {
  private audio: HTMLAudioElement | null = null;

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio(this.createRingtoneUrl());
      this.audio.loop = true;
      this.audio.preload = "auto";
      this.audio.volume = 0.8;
    }
    return this.audio;
  }

  async unlock(outputDeviceId?: string) {
    const audio = this.ensureAudio();
    await this.setOutputDevice(outputDeviceId);
    audio.muted = true;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
  }

  async setOutputDevice(outputDeviceId?: string) {
    const audio = this.ensureAudio() as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
    if (audio.setSinkId) {
      await audio.setSinkId(outputDeviceId || "");
    }
  }

  async start() {
    const audio = this.ensureAudio();
    if (!audio.paused) return;
    audio.currentTime = 0;
    await audio.play();
  }

  stop() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  private createRingtoneUrl(): string {
    const sampleRate = 44100;
    const seconds = 1.4;
    const samples = Math.floor(sampleRate * seconds);
    const dataSize = samples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < samples; i += 1) {
      const t = i / sampleRate;
      const active = t < 0.45 || (t > 0.7 && t < 1.05);
      const wave = active ? (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554.37 * t)) * 0.35 : 0;
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, wave)) * 0x7fff, true);
    }

    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  }
}
