import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load } from './check_output.ts';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const BUNDLE = join(ROOT, 'skills/uat-scenario-design/scripts');
// JSON test samples intentionally remain mutable so malformed input can be injected.
export type Sample = Record<string, any>;
export const fixture = (c = 'A'): Sample => load(join(ROOT, 'evals/fixtures', c + '.json')) as Sample;
export const output = (c = 'A', version = '0.4'): Sample => load(join(ROOT, 'evals/samples', 'v' + version, c + '.json')) as Sample;
export function scratch(): { work: string; cleanup: () => void } {
  const base = join(ROOT, '.test-work');
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, 'ts-'));
  return { work, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}
export function save(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value, null, 2), 'utf8'); }
export function cli(script: string, args: string[], cwd = ROOT) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 30_000,
  });
}
