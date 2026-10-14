// Adapts a vehicle row to each channel's text/format.
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const km = (n) => Number(n || 0).toLocaleString('pt-BR');

export function title(v, max = 60) {
  return `${v.brand} ${v.model} ${v.version || ''} ${v.year}`.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function description(v) {
  const lines = [
    `${v.brand} ${v.model} ${v.version || ''} — ${v.year}`.trim(),
    `Quilometragem: ${km(v.km)} km`,
    v.color && `Cor: ${v.color}`,
    v.fuel && `Combustível: ${v.fuel}`,
    v.transmission && `Câmbio: ${v.transmission}`,
    v.doors && `Portas: ${v.doors}`,
    `Preço: ${brl(v.price)}`,
    '',
    v.description || '',
    '',
    `${process.env.STORE_NAME || 'AutoPainel'} — aceitamos troca e financiamos.`,
  ];
  return lines.filter(l => l !== false && l !== undefined && l !== null).join('\n').trim();
}

export function photos(v) {
  const list = typeof v.photos === 'string' ? JSON.parse(v.photos || '[]') : (v.photos || []);
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return list.map(p => (p.startsWith('http') ? p : `${base}${p}`));
}

export const sku = (v) => `AP-${v.id}-${(v.plate || '').replace(/\W/g, '')}`;
export { brl };
