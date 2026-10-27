/**
 * Checks that bytes are a JPEG picture and drops everything a phone or camera writes into it besides the picture:
 * EXIF (with the GPS position), XMP, ICC profiles, comments, and whatever follows the end of the image (e.g. the video
 * of a "motion photo"). The guest's browser re-encodes every photo (canvas) anyway; this guards against a client that
 * does not. No image library: the TUKE server runs one bundled file on Node.js 18, without native modules.
 */
export interface Jpeg { width: number; height: number; data: Buffer }

/** Start-of-frame markers (they carry the size); C4, C8 and CC are other segments. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** APP1–APP15 except Adobe's APP14 (colour transform), and COM: metadata, never needed to show the picture. */
const isMetadata = (code: number) => (code >= 0xe1 && code <= 0xef && code !== 0xee) || code === 0xfe;
const isRestart = (code: number) => code >= 0xd0 && code <= 0xd7;

/** The picture without metadata, with its size; null when the bytes are no complete JPEG. */
export function cleanJpeg(buf: Buffer): Jpeg | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let width = 0, height = 0, scans = 0;
  let i = 2;
  for (;;) {
    // a marker: 0xFF (fill bytes 0xFF may repeat it) and its code
    if (i >= buf.length || buf[i] !== 0xff) return null;
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) return null;
    const code = buf[i]!;
    const start = i - 1;
    i++;
    if (code === 0xd9) { // end of image: anything after it is dropped
      if (!scans || !width || !height) return null;
      parts.push(buf.subarray(start, i));
      return { width, height, data: Buffer.concat(parts) };
    }
    if (code === 0x00 || code === 0xd8) return null;
    if (isRestart(code) || code === 0x01) { parts.push(buf.subarray(start, i)); continue; }
    if (i + 2 > buf.length) return null;
    const end = i + buf.readUInt16BE(i);
    if (end < i + 2 || end > buf.length) return null;
    if (SOF.has(code)) {
      if (end - i < 8) return null;
      height = buf.readUInt16BE(i + 3);
      width = buf.readUInt16BE(i + 5);
    }
    if (code !== 0xda) {
      if (!isMetadata(code)) parts.push(buf.subarray(start, end));
      i = end;
      continue;
    }
    // start of scan: the coded picture runs to the next marker (0xFF followed by neither 0x00 nor a restart marker);
    // a progressive JPEG has several scans with tables between them
    if (!width || !height) return null;
    scans++;
    let j = end;
    while (j < buf.length - 1 && !(buf[j] === 0xff && buf[j + 1] !== 0x00 && !isRestart(buf[j + 1]!))) j++;
    if (j >= buf.length - 1) return null; // cut off before the end of the image
    parts.push(buf.subarray(start, j));
    i = j;
  }
}
