/** WAV/RF64 header parsing, split out of main.js so it can be unit-tested.
 *
 * The IPC handler only reads the first few KB of the file and hands the buffer
 * here; nothing in this module touches the filesystem.
 */

/**
 * Parse a WAV or RF64 header.
 *
 * @param {Buffer} buf       Bytes from the start of the file.
 * @param {number} bytesRead How many bytes of `buf` are valid.
 * @returns {{channels:number,sampleRate:number,bitsPerSample:number,frames:number,format:string}|{error:string}}
 */
function parseWavHeader(buf, bytesRead) {
  if (bytesRead < 44) return { error: 'File too small for WAV header' };

  // Any polywav over 4 GB is RF64, not RIFF: the magic is 'RF64', the 32-bit
  // size fields carry 0xFFFFFFFF sentinels, and the true 64-bit sizes live in
  // a ds64 chunk. Rejecting RF64 here made the renderer fall back to a
  // hardcoded 1-channel placeholder, so a 63-channel field recording loaded
  // as mono.
  const magic = buf.toString('ascii', 0, 4);
  const isRf64 = magic === 'RF64';
  if ((magic !== 'RIFF' && !isRf64) || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return { error: 'Not a WAV file' };
  }

  const SIZE_SENTINEL = 0xFFFFFFFF;
  let pos = 12;
  let fmt = null;
  let dataSize = 0;
  let ds64DataSize = null;
  while (pos + 8 <= bytesRead) {
    const ckID = buf.toString('ascii', pos, pos + 4);
    const ckSize = buf.readUInt32LE(pos + 4);
    if (ckID === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bitsPerSample: buf.readUInt16LE(pos + 22),
      };
    } else if (ckID === 'ds64') {
      // ds64 body: riffSize (u64), dataSize (u64), sampleCount (u64), tableLength (u32)
      if (pos + 8 + 16 <= bytesRead) {
        ds64DataSize = Number(buf.readBigUInt64LE(pos + 16));
      }
    } else if (ckID === 'data') {
      dataSize = ckSize;
    }
    pos += 8 + ckSize + (ckSize % 2);
    if (pos >= bytesRead) break;
  }

  // Prefer the 64-bit size whenever RF64 gave us one; the 32-bit field is a
  // sentinel and would yield a nonsense frame count.
  if (ds64DataSize !== null) {
    dataSize = ds64DataSize;
  } else if (dataSize === SIZE_SENTINEL) {
    dataSize = 0;  // RF64 without a readable ds64 — frame count unknown
  }

  if (!fmt) return { error: 'No fmt chunk found' };

  const frames = (dataSize > 0 && fmt.channels > 0 && fmt.bitsPerSample > 0)
    ? Math.floor(dataSize / (fmt.channels * fmt.bitsPerSample / 8))
    : 0;

  return {
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample,
    frames: frames,
    format: (isRf64 ? 'RF64' : 'WAV') + ' / PCM_' + fmt.bitsPerSample,
  };
}

module.exports = { parseWavHeader };
