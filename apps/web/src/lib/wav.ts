export const MAX_SAMPLE_SEC = 60;

/** Decode any browser-supported audio (m4a, webm, mp3, wav …) and encode it as 16-bit mono WAV at 24 kHz. */
export async function toWav(arrayBuffer: ArrayBuffer): Promise<{ blob: Blob; seconds: number; truncated: boolean }> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }
  const rate = 24000;
  const seconds = Math.min(decoded.duration, MAX_SAMPLE_SEC);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return { blob: new Blob([buf], { type: 'audio/wav' }), seconds, truncated: decoded.duration > MAX_SAMPLE_SEC };
}
