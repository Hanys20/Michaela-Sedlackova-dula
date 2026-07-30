// Česká QR platba (SPD 1.0) – https://qr-platba.cz/pro-vyvojare/specifikace-formatu/
const COMBINING_MARKS = new RegExp('[̀-ͯ]', 'g');

function stripDiacritics(str) {
  return str.normalize('NFD').replace(COMBINING_MARKS, '');
}

function escapeSpdValue(str) {
  return stripDiacritics(str).replace(/\*/g, '').slice(0, 60);
}

export function buildSpdString({ iban, amount, variableSymbol, message }) {
  const parts = [
    'SPD',
    '1.0',
    `ACC:${iban.replace(/\s/g, '')}`,
    `AM:${Number(amount).toFixed(2)}`,
    'CC:CZK',
  ];
  if (variableSymbol) parts.push(`X-VS:${variableSymbol}`);
  if (message) parts.push(`MSG:${escapeSpdValue(message)}`);
  return parts.join('*');
}
