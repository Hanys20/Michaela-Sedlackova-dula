import qrcode from 'qrcode-generator';

// Vrací syrové GIF bajty (Uint8Array) QR kódu pro daný text.
// Knihovna qrcode-generator má vlastní čistě-JS GIF enkodér (createDataURL),
// takže není potřeba žádný canvas ani vlastní PNG/deflate implementace.
export function renderQrGif(text, { cellSize = 6 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const dataUrl = qr.createDataURL(cellSize);
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
