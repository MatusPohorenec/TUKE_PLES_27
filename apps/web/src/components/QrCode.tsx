import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** QR code as inline SVG, silver on transparent, for the wall. */
export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#eef3ffff', light: '#00000000' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [value]);
  return <div className="qr" style={{ width: size, height: size }} aria-label={`QR kód: ${value}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}
