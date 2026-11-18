// Display helpers for the Kitchen and Shop pages. Mirrors the backend's SHORT_UNITS.
const SHORT_UNITS = {
  ounce: 'oz', pound: 'lb', gram: 'g', kilogram: 'kg', cup: 'cup', tablespoon: 'tbsp',
  teaspoon: 'tsp', 'fluid ounce': 'fl oz', pint: 'pt', quart: 'qt', gallon: 'gal',
  milliliter: 'ml', liter: 'l'
};

const GLYPHS = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾']
];
const TOLERANCE = 0.01;

function fractionGlyph(fraction) {
  const match = GLYPHS.find(([value]) => Math.abs(value - fraction) < TOLERANCE);
  return match ? match[1] : null;
}

// 0.5 -> "½", 1.5 -> "1½", 2 -> "2", 1.236 -> "1.24".
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const whole = Math.floor(number + TOLERANCE);
  const glyph = fractionGlyph(number - whole);
  if (number >= 0 && glyph) return whole > 0 ? `${whole}${glyph}` : glyph;
  if (Math.abs(number - Math.round(number)) < TOLERANCE / 10) return String(Math.round(number));
  return String(Math.round(number * 100) / 100);
}

// formatQuantity(1.5, 'cup') -> "1½ cup"; formatQuantity(2, 'tablespoon') -> "2 tbsp".
export function formatQuantity(quantity, unit) {
  const text = formatNumber(quantity);
  if (!text) return '';
  const label = unit ? (SHORT_UNITS[unit] || unit) : '';
  return label ? `${text} ${label}` : text;
}

// "2026-11-03T14:00:00Z" -> "Added Nov 3". Empty when there is no date.
export function formatAddedDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `Added ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
