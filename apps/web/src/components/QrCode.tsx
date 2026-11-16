import { useEffect, useId, useState } from 'react';
import QRCode from 'qrcode';
import { EMBLEM_LINES, EMBLEM_QR, EMBLEM_SIZE } from './emblemQr.ts';

/** A development server shows the production code in the emblem (a phone cannot open localhost anyway). */
const PRODUCTION = 'https://srdcom.tuke.sk';
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?=\/)/;
/**
 * The emblem is drawn this much larger than a plain code of the same `size` (its 57 modules then stay about 4 px on
 * the wall), but at most 22 % of the screen's height, so a laptop's wall keeps room for the globe.
 */
const EMBLEM_SCALE = 1.6;
const EMBLEM_MAX = '22vh';

/**
 * QR code as inline SVG, silver on transparent, for the wall. Where qr/zdroj/wall_emblem.py made a code in the shape
 * of the TUKE emblem for the address (each venue's guest form, like the invitation's code), the emblem; any other
 * address (e.g. with an access code), or `plain`, gets a plain code.
 */
export function QrCode({ value, size = 160, plain = false }: { value: string; size?: number; plain?: boolean }) {
  const shown = value.replace(LOCAL, PRODUCTION);
  const emblem = plain ? undefined : EMBLEM_QR[shown];
  const gradient = `qr-silver-${useId().replace(/[^\w-]/g, '')}`;
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (emblem) return;
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#eef3ffff', light: '#00000000' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [value, emblem]);
  if (emblem) {
    const side = `min(${Math.round(size * EMBLEM_SCALE)}px, ${EMBLEM_MAX})`;
    return (
      <div className="qr qr-emblem" style={{ width: side, height: side }} aria-label={`QR kód: ${shown}`} role="img">
        <svg viewBox={`-0.5 -0.5 ${EMBLEM_SIZE + 1} ${EMBLEM_SIZE + 1}`} aria-hidden="true">
          {/* silver like the foil on the invitation, light enough everywhere to read as well as plain silver */}
          <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={EMBLEM_SIZE}>
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#ccd6f4" />
          </linearGradient>
          <g fill={`url(#${gradient})`}>
            <path fillRule="evenodd" d={EMBLEM_LINES} />
            <path d={emblem.modules} shapeRendering="crispEdges" />
          </g>
        </svg>
      </div>
    );
  }
  return <div className="qr" style={{ width: size, height: size }} aria-label={`QR kód: ${value}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}
