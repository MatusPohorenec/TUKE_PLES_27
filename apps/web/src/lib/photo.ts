/**
 * A guest's photo, made ready in the browser before it is sent: turned upright (the browser applies the camera's
 * orientation when it decodes), scaled down to the wall's size and a small copy for the admin's list, re-encoded as
 * JPEG. Re-encoding drops everything else in the file (EXIF with the GPS position, the camera); the API strips it
 * again in case another client does not.
 */
import { LIMITS } from '@ples/shared/constants';

export interface PreparedPhoto { photo: Blob; thumb: Blob; width: number; height: number; preview: string }

export class PhotoError extends Error {}

/** Draws the image at most `side` px on its long side (in two steps from very large photos, sharper in every browser). */
function scaled(source: CanvasImageSource, w0: number, h0: number, side: number): HTMLCanvasElement {
  let canvas: CanvasImageSource = source;
  let w = w0, h = h0;
  const target = Math.min(1, side / Math.max(w0, h0));
  const steps = target < 0.5 ? [Math.max(target, Math.min(1, (side * 2) / Math.max(w0, h0))), target] : [target];
  let out!: HTMLCanvasElement;
  for (const k of steps) {
    const nw = Math.max(1, Math.round(w0 * k)), nh = Math.max(1, Math.round(h0 * k));
    out = document.createElement('canvas');
    out.width = nw;
    out.height = nh;
    const ctx = out.getContext('2d');
    if (!ctx) throw new PhotoError('Fotku sa nepodarilo pripraviť. Skús to znova.');
    ctx.fillStyle = '#020617'; // a transparent PNG gets the night behind it, not black edges
    ctx.fillRect(0, 0, nw, nh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h, 0, 0, nw, nh);
    canvas = out;
    w = nw;
    h = nh;
  }
  return out;
}

const jpeg = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(b => (b && b.type === 'image/jpeg' ? resolve(b) : reject(new PhotoError('Tento prehliadač nevie fotku pripraviť. Skús iný.'))), 'image/jpeg', quality);
});

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('Toto nie je fotka. Vyber obrázok (JPG alebo PNG).');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new PhotoError('Túto fotku sa nepodarilo otvoriť. Skús inú (JPG alebo PNG).'); }
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) throw new PhotoError('Túto fotku sa nepodarilo otvoriť. Skús inú (JPG alebo PNG).');
    const big = scaled(img, w0, h0, LIMITS.photoSide);
    let photo = await jpeg(big, 0.82);
    if (photo.size > LIMITS.photoBytes * 0.9) photo = await jpeg(big, 0.68); // a very detailed picture
    const thumb = await jpeg(scaled(big, big.width, big.height, LIMITS.photoThumbSide), 0.72);
    return { photo, thumb, width: big.width, height: big.height, preview: URL.createObjectURL(photo) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
