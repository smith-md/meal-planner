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

// "1", "1/2", "1 1/2", "0.75" -> number; anything else (or a negative) -> null.
export function parseQuantityText(text) {
  const value = String(text ?? '').trim();
  let match = value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (match) return Number(match[3]) ? Number(match[1]) + Number(match[2]) / Number(match[3]) : null;
  match = value.match(/^(\d+)\/(\d+)$/);
  if (match) return Number(match[2]) ? Number(match[1]) / Number(match[2]) : null;
  if (/^(\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  return null;
}

// formatQuantityText("1 1/2", "cup") -> "1½ cup". Falls back to the raw text if it cannot be read.
export function formatQuantityText(text, unit) {
  const number = parseQuantityText(text);
  return number === null ? [text, unit].filter(Boolean).join(' ') : formatQuantity(number, unit);
}

// Unit words the backend understands (pairings.UNIT_ALIASES), plus "dozen", for splitting a typed amount.
const UNIT_WORDS = new Set((
  'cup cups c tablespoon tablespoons tbsp tbs teaspoon teaspoons tsp pint pints pt quart quarts qt ' +
  'gallon gallons gal milliliter milliliters ml liter liters l ounce ounces oz pound pounds lb lbs ' +
  'gram grams g kilogram kilograms kg piece pieces pc each whole clove cloves bunch bunches can cans ' +
  'package packages pkg bag bags head heads dozen'
).split(' '));
const LONG_TO_SHORT = {};
Object.entries(SHORT_UNITS).forEach(([long, short]) => {
  LONG_TO_SHORT[long] = short;
  LONG_TO_SHORT[`${long}s`] = short;
});
const LEADING_NUMBER = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])(?=\s|$)/;
const TWO_WORD_UNITS = ['fluid ounces', 'fluid ounce', 'fl oz'];

// "2 lb cabbage" -> { number: "2", unit: "lb", name: "cabbage", quantity: "2 lb" }.
// With no leading number the whole text is the name and quantity is "".
// With quantityOnly ("2 lb") the text has no item name, so a trailing unit word is still a unit.
export function splitAmount(text, { quantityOnly = false } = {}) {
  const value = String(text ?? '').trim();
  const match = value.match(LEADING_NUMBER);
  if (!match) return { number: '', unit: '', name: value, quantity: '' };
  const number = match[1];
  const rest = value.slice(match[0].length).trim();
  const lower = rest.toLowerCase();
  let unit = '';
  let name = rest;
  const phrase = TWO_WORD_UNITS.find(candidate => lower.startsWith(`${candidate} `) || (quantityOnly && lower === candidate));
  if (phrase) {
    unit = rest.slice(0, phrase.length);
    name = rest.slice(phrase.length).trim();
  } else {
    const word = rest.split(/\s+/)[0];
    if (word && UNIT_WORDS.has(word.toLowerCase()) && (quantityOnly || rest.length > word.length)) {
      unit = word;
      name = rest.slice(word.length).trim();
    }
  }
  return { number, unit, name, quantity: [number, unit].filter(Boolean).join(' ') };
}

// Quantity text with the unit abbreviated like the rest of the UI: "2 pound" -> "2 lb".
export function abbreviateQuantity(quantity) {
  const { number, unit } = splitAmount(quantity, { quantityOnly: true });
  if (!number) return String(quantity ?? '').trim();
  const parsed = parseQuantityText(number);
  const shownNumber = parsed === null ? number : formatNumber(parsed);
  const shownUnit = unit ? (LONG_TO_SHORT[unit.toLowerCase()] || unit) : '';
  return [shownNumber, shownUnit].filter(Boolean).join(' ');
}

// "2 pound cabbage" -> "2 lb cabbage". Text without a leading number is returned as is.
export function abbreviateAmount(text) {
  const { quantity, name } = splitAmount(text);
  if (!quantity) return String(text ?? '').trim();
  return [abbreviateQuantity(quantity), name].filter(Boolean).join(' ');
}

// The amount text sent to the server: "<quantity> <item name>". Empty when there is no quantity.
// A quantity that already ends with the name ("2 lb cabbage") is not given the name twice.
export function composeAmount(quantity, name) {
  const qty = String(quantity ?? '').trim();
  const item = String(name ?? '').trim();
  if (!qty) return '';
  if (!item || qty.toLowerCase().endsWith(` ${item.toLowerCase()}`)) return qty;
  return `${qty} ${item}`;
}

// Unit names the backend recognises when it reads an amount. Source: backend/app/pairings.py
// (UNIT_ALIASES, including the "fluid ounce" group). Keep in step with that file; "dozen" is
// deliberately absent because the backend does not know it.
const BACKEND_UNITS = new Set([
  ...(
    'cup cups c tablespoon tablespoons tbsp tbs teaspoon teaspoons tsp pint pints pt quart quarts qt ' +
    'gallon gallons gal milliliter milliliters ml liter liters l ounce ounces oz pound pounds lb lbs ' +
    'gram grams g kilogram kilograms kg piece pieces pc each whole clove cloves bunch bunches can cans ' +
    'package packages pkg bag bags head heads floz'
  ).split(' '),
  'fluid ounces', 'fluid ounce', 'fl oz'
]);
const BACKEND_GLYPHS = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };
const QUANTITY_SHAPE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)(?:\s+(.+))?$/;

export const QUANTITY_ERROR = 'Use a number, or a number and a unit like lb or cup.';

// Checks a typed amount the way the backend will read it: a number, optionally followed by exactly
// one unit word the backend knows. Returns 'empty' (not chosen yet), 'ok' or 'invalid'.
export function checkQuantityText(text) {
  let value = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  if (!value) return 'empty';
  Object.entries(BACKEND_GLYPHS).forEach(([glyph, fraction]) => {
    value = value.split(glyph).join(` ${fraction}`).trim();
  });
  const match = value.match(QUANTITY_SHAPE);
  if (!match) return 'invalid';
  const number = parseQuantityText(match[1]);
  if (number === null || !(number > 0)) return 'invalid';
  if (match[2] && !BACKEND_UNITS.has(match[2])) return 'invalid';
  return 'ok';
}

// "Tuesday" -> "Tue"; anything else is returned as is.
export function shortDayName(name) {
  const match = String(name || '').match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i);
  return match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : String(name || '');
}
