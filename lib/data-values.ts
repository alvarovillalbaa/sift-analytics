import type { Value } from './types';

/** Number lexemes are kept out of JavaScript Number until a source type is chosen. */
export class ExactNumber {
  constructor(readonly text: string) {}
}

/** Parse JSON without rounding number tokens, including numbers inside nested values. */
export function parseExactJson(text: string, budget = { remaining: 1_000_000 }): unknown {
  let offset = 0;
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const space = () => { while (offset < text.length && /[\t\n\r ]/.test(text[offset])) offset++; };
  function string(): string {
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '\\') offset++;
      else if (character === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    throw new Error('Unterminated JSON string.');
  }
  function value(depth: number): unknown {
    if (depth > 100 || --budget.remaining < 0) throw new Error('JSON exceeds the local nesting or value-count limit.');
    space();
    const character = text[offset];
    if (character === '"') return string();
    if (character === '[' || character === '{') {
      const array = character === '[';
      const closing = array ? ']' : '}';
      const result: unknown[] | Record<string, unknown> = array ? [] : Object.create(null) as Record<string, unknown>;
      offset++; space();
      if (text[offset] === closing) { offset++; return result; }
      while (offset < text.length) {
        space();
        let key = '';
        if (!array) {
          if (text[offset] !== '"') throw new Error('JSON object keys must be strings.');
          key = string(); space();
          if (text[offset++] !== ':') throw new Error('Expected a colon after a JSON object key.');
        }
        const item = value(depth + 1);
        if (array) (result as unknown[]).push(item);
        else (result as Record<string, unknown>)[key] = item;
        space();
        const delimiter = text[offset++];
        if (delimiter === closing) return result;
        if (delimiter !== ',') throw new Error('Expected a comma or closing bracket in JSON.');
      }
      throw new Error('Unterminated JSON array or object.');
    }
    for (const [token, literal] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, offset)) { offset += token.length; return literal; }
    }
    numberToken.lastIndex = offset;
    const number = numberToken.exec(text);
    if (!number) throw new Error(`Invalid JSON value at character ${offset + 1}.`);
    offset += number[0].length;
    return new ExactNumber(number[0]);
  }
  const result = value(0);
  space();
  if (offset !== text.length) throw new Error(`Unexpected JSON content at character ${offset + 1}.`);
  return result;
}

/** Bound workbook expansion before the XLSX library allocates XML and cell data. */
export function checkWorkbookArchive(bytes: ArrayBuffer): void {
  const archive = new DataView(bytes);
  let end = -1;
  for (let index = archive.byteLength - 22; index >= Math.max(0, archive.byteLength - 65_557); index--) {
    if (archive.getUint32(index, true) === 0x06054b50
      && index + 22 + archive.getUint16(index + 20, true) === archive.byteLength) { end = index; break; }
  }
  if (end < 0) throw new Error('The workbook does not contain a valid XLSX ZIP directory.');
  const entries = archive.getUint16(end + 10, true);
  const size = archive.getUint32(end + 12, true);
  let offset = archive.getUint32(end + 16, true);
  const directoryEnd = offset + size;
  if (archive.getUint16(end + 4, true) || archive.getUint16(end + 6, true)
    || entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('Split or ZIP64 workbooks are not supported.');
  if (entries > 4096 || offset + size > end) throw new Error('The workbook directory exceeds the local import limit.');
  let expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || archive.getUint32(offset, true) !== 0x02014b50) throw new Error('The workbook has an invalid ZIP directory entry.');
    const length = archive.getUint32(offset + 24, true);
    expanded += length;
    if (length > 32 * 1024 * 1024 || expanded > 64 * 1024 * 1024) throw new Error('The workbook exceeds the 64 MB expanded-data limit (32 MB per archive entry). Export a smaller workbook or a single sheet.');
    if (archive.getUint16(offset + 8, true) & 1) throw new Error('Password-protected workbooks are not supported.');
    offset += 46 + archive.getUint16(offset + 28, true) + archive.getUint16(offset + 30, true) + archive.getUint16(offset + 32, true);
    if (offset > end) throw new Error('The workbook has an invalid ZIP directory size.');
  }
  if (offset !== directoryEnd) throw new Error('The workbook ZIP directory count and size do not match.');
}

function exactJson(value: unknown): string {
  if (value instanceof ExactNumber) return value.text;
  if (Array.isArray(value)) return `[${value.map(exactJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${exactJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function cellText(value: unknown): string {
  if (value instanceof ExactNumber) return value.text;
  if (value instanceof Date) return value.toISOString();
  return value && typeof value === 'object' ? exactJson(value) : String(value ?? '');
}

function decimalParts(token: string): { integerDigits: number; scale: number } | null {
  const match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match || (match[3]?.replace(/^[+-]/, '').length ?? 0) > 3) return null;
  const integer = match[1];
  const fraction = match[2] ?? '';
  // This bounded exponent is an integer shift, never a conversion of the value.
  const exponent = match[3] ? parseInt(match[3], 10) : 0;
  const digits = `${integer}${fraction}`.replace(/^0+/, '');
  const scale = Math.max(0, fraction.length - exponent);
  const integerDigits = Math.max(0, digits.length + exponent - fraction.length);
  return { integerDigits: Math.max(1, integerDigits), scale };
}

/** Every JSON/XLSX column gets an explicit type, so quoted IDs are never inferred as numbers. */
export function importColumnType(values: unknown[]): string {
  const present = values.filter((value) => value != null);
  if (!present.length) return 'VARCHAR';
  if (present.every((value) => value instanceof ExactNumber)) {
    const parts = present.map((value) => decimalParts((value as ExactNumber).text));
    if (parts.some((part) => !part)) return 'VARCHAR';
    const scale = parts.reduce((maximum, part) => Math.max(maximum, part!.scale), 0);
    const integerDigits = parts.reduce((maximum, part) => Math.max(maximum, part!.integerDigits), 1);
    return integerDigits + scale <= 38 ? `DECIMAL(${integerDigits + scale},${scale})` : 'VARCHAR';
  }
  if (present.every((value) => typeof value === 'boolean')) return 'BOOLEAN';
  if (present.every((value) => value instanceof Date)) return 'TIMESTAMP';
  return 'VARCHAR';
}

type ArrowType = { toString(): string; scale?: number; unit?: number; timezone?: string | null };

function scaledInteger(value: string, scale: number): string {
  if (!/^-?\d+$/.test(value)) throw new Error('The analytical engine returned an invalid decimal representation.');
  const negative = value.startsWith('-');
  const digits = value.replace(/^-/, '');
  if (scale <= 0) return `${negative ? '-' : ''}${digits}${'0'.repeat(-scale)}`;
  const padded = digits.padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function temporal(raw: bigint, type: ArrowType, timestamp: boolean): string {
  const unit = type.unit ?? 1;
  const precision = [0, 3, 6, 9][unit];
  const unitsPerSecond = [1n, 1000n, 1_000_000n, 1_000_000_000n][unit];
  if (unitsPerSecond == null) throw new Error('The analytical engine returned an unsupported time unit.');
  let seconds = raw / unitsPerSecond;
  let remainder = raw % unitsPerSecond;
  if (remainder < 0) { seconds--; remainder += unitsPerSecond; }
  const fraction = precision ? `.${remainder.toString().padStart(precision, '0')}` : '';
  if (!timestamp) {
    if (seconds < 0 || seconds >= 86_400) throw new Error('Time is outside the supported 24-hour range. Cast the column to VARCHAR to inspect its source representation.');
    return `${(seconds / 3600n).toString().padStart(2, '0')}:${(seconds / 60n % 60n).toString().padStart(2, '0')}:${(seconds % 60n).toString().padStart(2, '0')}${fraction}`;
  }
  if (raw === 9_223_372_036_854_775_807n) return 'infinity';
  if (raw === -9_223_372_036_854_775_807n) return '-infinity';
  const milliseconds = seconds * 1000n;
  if (milliseconds > 8_640_000_000_000_000n || milliseconds < -8_640_000_000_000_000n) {
    throw new Error('Timestamp is outside the supported calendar range. Cast the column to VARCHAR to inspect its source representation.');
  }
  const iso = new Date(Number(milliseconds)).toISOString();
  return `${iso.slice(0, iso.lastIndexOf('.'))}${fraction}${type.timezone ? 'Z' : ''}`;
}

/** Raw timestamp integers bypass Arrow's fractional-millisecond Number getter. */
export function serializeArrowValue(value: unknown, type: ArrowType, raw?: bigint): Value {
  if (value == null) return null;
  const name = type.toString();
  if (/^Decimal/.test(name)) {
    const decimal = scaledInteger(String(value), type.scale ?? 0);
    if (!(type.scale ?? 0)) {
      const integer = BigInt(decimal);
      if (integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(integer);
    }
    return decimal;
  }
  if (/^Timestamp/.test(name)) {
    if (raw === undefined) throw new Error('Timestamp precision metadata is unavailable. Cast the column to VARCHAR.');
    return temporal(raw, type, true);
  }
  if (/^Time\d/.test(name)) return temporal(typeof value === 'bigint' ? value : BigInt(String(value)), type, false);
  if (/^Date/.test(name)) {
    const date = value instanceof Date ? value : new Date(Number(value));
    if (!Number.isFinite(date.valueOf())) throw new Error('Date is outside the supported calendar range. Cast the column to VARCHAR.');
    return date.toISOString().split('T')[0];
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  throw new Error('This result contains a nested, binary, or interval value. Cast that column to VARCHAR in SQL to preserve its source representation.');
}
