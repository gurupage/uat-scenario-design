/** JSON/Python compatibility helpers. No runtime dependency outside Node. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, unknown>;
const numericSources = new WeakMap<object, Map<string, { value: number; source: string }>>();
const keyOrders = new WeakMap<object, string[]>();
function entries(value: Row): [string, unknown][] {
  const saved = keyOrders.get(value) ?? [];
  const keys = [...saved.filter(key => Object.hasOwn(value, key)), ...Object.keys(value).filter(key => !saved.includes(key))];
  return keys.map(key => [key, value[key]]);
}
// JSON.parse sorts integer-like property names. Remember their original order
// without replacing the native JSON parser or exposing metadata in user data.
function rememberKeyOrder(source: string, value: unknown): void {
  let offset = 0;
  const whitespace = (): void => { while (offset < source.length && /\s/.test(source[offset]!)) offset++; };
  function stringToken(): string {
    const start = offset++;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === '\\') offset++;
      else if (char === '"') break;
    }
    return source.slice(start, offset);
  }
  function walk(current: unknown): void {
    whitespace();
    if (source[offset] === '{') {
      offset++; whitespace();
      const keys: string[] = [];
      while (source[offset] !== '}') {
        const key = JSON.parse(stringToken()) as string;
        if (!keys.includes(key)) keys.push(key);
        whitespace(); offset++;
        walk(object(current) ? current[key] : undefined);
        whitespace();
        if (source[offset] !== ',') break;
        offset++; whitespace();
      }
      offset++;
      if (object(current)) keyOrders.set(current, keys);
    } else if (source[offset] === '[') {
      offset++; whitespace();
      let index = 0;
      while (source[offset] !== ']') {
        walk(Array.isArray(current) ? current[index++] : undefined);
        whitespace();
        if (source[offset] !== ',') break;
        offset++; whitespace();
      }
      offset++;
    } else if (source[offset] === '"') stringToken();
    else while (offset < source.length && !/[\s,}\]]/.test(source[offset]!)) offset++;
  }
  walk(value);
}
export const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
export const truth = (value: unknown): boolean => value !== null && value !== undefined && value !== false && value !== 0 && value !== '' && (!Array.isArray(value) || value.length > 0) && (!object(value) || Object.keys(value).length > 0);
// Python str.strip() treats U+001C..U+001F and U+0085 as whitespace, but not BOM.
export const nonempty = (value: unknown): value is string => typeof value === 'string' && value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '').length > 0;
export function pyString(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && (!Number.isInteger(value) || Object.is(value, -0))) return floatString(value);
  if (Array.isArray(value)) return '[' + value.map(pyRepr).join(', ') + ']';
  if (object(value)) return '{' + entries(value).map(([key, item]) => pyRepr(key) + ': ' + pyRepr(item)).join(', ') + '}';
  return String(value);
}
function pyRepr(value: unknown): string {
  if (typeof value !== 'string') return pyString(value);
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  return quote + value.replace(/\\/g, '\\\\').replaceAll(quote, '\\' + quote).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + quote;
}
export function required(row: Row, key: string): unknown {
  if (!Object.hasOwn(row, key)) throw new Error(pyRepr(key));
  return row[key];
}
export function member(value: unknown, choices: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) throw new Error("unhashable type: 'list'");
  if (object(value)) throw new Error("unhashable type: 'dict'");
  return typeof value === 'string' && choices.has(value);
}
export function equal(a: unknown, b: unknown): boolean {
  if (a === b || ((a === null || a === undefined) && (b === null || b === undefined))) return true;
  if ((typeof a === 'number' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'boolean')) return Number(a) === Number(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => Object.hasOwn(b, k) && equal(v, b[k]));
  return false;
}
export function load(path: string): unknown {
  const contents = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
  const parse = JSON.parse as (source: string, reviver: (this: object, key: string, value: unknown, context?: { source?: string }) => unknown) => unknown;
  const value = parse(contents, function (key, value, context) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('JSON number cannot be represented safely: ' + context?.source);
      const source = context?.source;
      if (source !== undefined) {
        const entries = numericSources.get(this) ?? new Map();
        entries.set(key, { value, source });
        numericSources.set(this, entries);
      }
    }
    return value;
  });
  rememberKeyOrder(contents, value);
  return value;
}
function floatString(value: number): string {
  if (Object.is(value, -0)) return '-0.0';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)) {
    return value.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
  }
  return Number.isInteger(value) ? String(value) + '.0' : String(value);
}
export function jsonBody(value: unknown): string {
  const active = new Set<object>();
  function encode(item: unknown, level: number, owner?: object, key?: string): string {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) throw new Error('JSON number cannot be represented safely: ' + item);
      const saved = owner && key !== undefined ? numericSources.get(owner)?.get(key) : undefined;
      const floating = saved && Object.is(saved.value, item) ? /[.eE]/.test(saved.source) : !Number.isInteger(item) || Object.is(item, -0);
      return floating ? floatString(item) : JSON.stringify(item);
    }
    if (!Array.isArray(item) && !object(item)) throw new Error('Unsupported JSON value: ' + typeof item);
    if (active.has(item)) throw new Error('Circular reference detected');
    active.add(item);
    const indent = '  '.repeat(level + 1);
    const parts = Array.isArray(item) ? item.map((v, i) => encode(v, level + 1, item, String(i))) : entries(item).map(([k, v]) => JSON.stringify(k) + ': ' + encode(v, level + 1, item, k));
    active.delete(item);
    const [left, right] = Array.isArray(item) ? ['[', ']'] : ['{', '}'];
    return parts.length ? left + '\n' + indent + parts.join(',\n' + indent) + '\n' + '  '.repeat(level) + right : left + right;
  }
  return encode(value, 0);
}
export function direct(url: string): boolean { return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(url); }
export function parseArgs(argv: string[], requiredNames: string[], optionalNames: string[] = []): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  const known = new Set([...requiredNames, ...optionalNames]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg : arg.slice(0, separator);
    if (!known.has(name)) throw new Error('unrecognized arguments: ' + arg);
    const value = separator < 0 ? argv[++i] : arg.slice(separator + 1);
    if (value === undefined || (separator < 0 && value.startsWith('--'))) throw new Error('argument ' + name + ': expected one argument');
    result[name] = value;
  }
  const missing = requiredNames.filter(name => !Object.hasOwn(result, name));
  if (missing.length) throw new Error('the following arguments are required: ' + missing.join(', '));
  return result;
}
