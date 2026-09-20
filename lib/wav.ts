// Strict reader for the exact WAV the browser recorder produces (16 kHz mono
// 16-bit PCM, see lib/recorder.ts).
//
// The voice endpoint used to bill STT seconds as `(bytes - 44) / 32000` and
// forward the client's own Content-Type to the engine untouched. Both halves
// of that were the client's to choose: a 100 KB Opus or AAC file declaring
// itself audio/ogg was charged ~3 seconds while carrying ten minutes of speech
// the engine would really have had to process. Parsing the container closes it
// — a format we cannot measure is a format we do not accept.

export const WAV_SAMPLE_RATE = 16000;
export const WAV_CHANNELS = 1;
export const WAV_BITS = 16;
const BYTES_PER_SECOND = (WAV_SAMPLE_RATE * WAV_CHANNELS * WAV_BITS) / 8;

/** Five minutes of the format above, plus room for the header. Nothing the
 *  recorder produces comes close; nginx's 25 MB is the outer wall, this is the
 *  one that matches the product. */
export const MAX_AUDIO_BYTES = BYTES_PER_SECOND * 300 + 4096;

export type WavInfo = { seconds: number };

function ascii(buf: Buffer, at: number): string {
  return buf.toString("ascii", at, at + 4);
}

/** Duration of a canonical PCM WAV, or null if this is not one. */
export function parseWav(buf: Buffer): WavInfo | null {
  if (buf.length < 44 || ascii(buf, 0) !== "RIFF" || ascii(buf, 8) !== "WAVE") return null;

  let fmtOk = false;
  let dataBytes = 0;
  let offset = 12;

  // Chunk walk rather than fixed offsets: the header is 44 bytes for our own
  // recorder, but a LIST/fact chunk before `data` is legal WAV.
  while (offset + 8 <= buf.length) {
    const id = ascii(buf, offset);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt ") {
      if (size < 16 || body + 16 > buf.length) return null;
      const audioFormat = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (audioFormat !== 1 || channels !== WAV_CHANNELS || sampleRate !== WAV_SAMPLE_RATE || bits !== WAV_BITS) {
        return null;
      }
      fmtOk = true;
    } else if (id === "data") {
      // A declared size larger than the file is either a truncated upload or a
      // lie meant to be believed; either way only the bytes that are actually
      // here can be transcribed, so only those are charged.
      dataBytes = Math.min(size, buf.length - body);
    }

    // Chunks are word-aligned.
    offset = body + size + (size % 2);
    if (size === 0) break; // malformed: no forward progress
  }

  if (!fmtOk || dataBytes <= 0) return null;
  return { seconds: dataBytes / BYTES_PER_SECOND };
}
