/** Saved-output regression runner. Does not generate scenarios. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { load, validate, SUPPORTED_VERSIONS } from './check_output.ts';
import { render } from './render_output.ts';
import { read_skill_version } from './validate_skill.ts';
export { read_skill_version } from './validate_skill.ts';
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export function digest(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export function write_json(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' }); }
export interface CommandResult { exit_code: number; stdout: string; stderr: string }
export interface RunnerDependencies {
  readSkillVersion?: (path: string) => string;
  execute?: (command: string[]) => CommandResult;
  print?: (message: string) => void;
}
function execute(command: string[]): CommandResult {
  const result = spawnSync(command[0]!, command.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 90_000, maxBuffer: 10 * 1024 * 1024 });
  return { exit_code: result.status ?? -1, stdout: result.stdout ?? '', stderr: (result.stderr ?? '') + (result.error ? String(result.error) : '') };
}
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.name === '__pycache__') return [];
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  }).sort();
}
export function main(argv = process.argv.slice(2), dependencies: RunnerDependencies = {}): number {
  const { values } = parseArgs({ args: argv, options: {
    run: { type: 'string' }, 'report-dir': { type: 'string' }, cases: { type: 'string', default: 'A,B,C,D,E,F,G' },
    'fixture-dir': { type: 'string', default: join(ROOT, 'evals/fixtures') }, 'expected-version': { type: 'string' },
    'skill-validator': { type: 'string', default: join(ROOT, 'scripts/validate_skill.ts') },
  }, strict: true, allowPositionals: false });
  if (!values.run || !values['report-dir']) throw new Error('--run and --report-dir are required');
  const skillVersion = (dependencies.readSkillVersion ?? read_skill_version)(join(ROOT, 'skills/uat-scenario-design/SKILL.md'));
  const expectedVersion = values['expected-version'] ?? skillVersion;
  if (!Array.from(SUPPORTED_VERSIONS).includes(expectedVersion)) throw new Error('Unsupported expected version');
  if (extname(values['skill-validator']!) !== '.ts') throw new Error('--skill-validator must be a TypeScript (.ts) validator');
  const run = resolve(values.run), fixtureDir = resolve(values['fixture-dir']!), reportDir = resolve(values['report-dir']);
  const cases = values.cases!.split(',').map(c => c.trim()).filter(Boolean);
  if (cases.some(c => !/^[\p{L}\p{N}]+$/u.test(c))) throw new Error('case names must be alphanumeric');
  if (new Set(cases).size !== cases.length) throw new Error('case names must be unique');
  // mkdir recursive cannot enforce nonexistence, so create parents separately then the leaf exclusively.
  mkdirSync(dirname(reportDir), { recursive: true }); mkdirSync(reportDir);
  const report: { [key: string]: any; cases: any[]; commands: any[]; provenance: { path: string; sha256: string }[] } = {
    created_at: new Date().toISOString(), cases: [], commands: [], provenance: [],
    limitations: ['saved-output regression only; AI generation and semantic review are separate'], expected_version: expectedVersion,
    version_mode: values['expected-version'] ? 'explicit_compatibility' : 'current_skill', current_skill_version: skillVersion,
    fixture_dir: fixtureDir, run,
  };
  let allOk = cases.length > 0;
  for (const c of cases) {
    const fixture = join(fixtureDir, c + '.json'), output = join(run, c + '.json'); let result: Record<string, unknown>;
    try {
      const data = load(output), errors = validate(load(fixture), data, expectedVersion);
      const scenarios = data !== null && typeof data === 'object' && 'scenarios' in data ? data.scenarios : undefined;
      result = { case: c, passed: errors.length === 0, errors, fixture_sha256: digest(fixture), output_sha256: digest(output), scenario_count: Array.isArray(scenarios) ? scenarios.length : null };
      if (!errors.length) writeFileSync(join(reportDir, c + '.md'), render(data), { encoding: 'utf8', flag: 'wx' });
    } catch (error) { result = { case: c, passed: false, errors: [String(error)] }; }
    allOk = allOk && result.passed === true; report.cases.push(result); write_json(join(reportDir, c + '.check.json'), result);
  }
  const tests = readdirSync(join(ROOT, 'scripts')).filter(name => /^test_.*\.ts$/.test(name) && name !== 'test_helpers.ts').sort().map(name => join(ROOT, 'scripts', name));
  const commands: [string, string[]][] = [
    ['tests', [process.execPath, '--test', ...tests]],
    ['skill_format', [process.execPath, resolve(values['skill-validator']!), join(ROOT, 'skills/uat-scenario-design')]],
  ];
  for (const [name, command] of commands) {
    let result: CommandResult;
    try { result = (dependencies.execute ?? execute)(command); }
    catch (error) { result = { exit_code: -1, stdout: '', stderr: String(error) }; }
    const entry = { name, ...result }; report.commands.push(entry); allOk = allOk && entry.exit_code === 0;
    writeFileSync(join(reportDir, name + '.txt'), entry.stdout + entry.stderr, { encoding: 'utf8', flag: 'wx' });
  }
  for (const folder of ['skills', 'scripts']) for (const path of files(join(ROOT, folder))) report.provenance.push({ path: relative(ROOT, path).replaceAll('\\', '/'), sha256: digest(path) });
  report.passed = allOk; write_json(join(reportDir, 'summary.json'), report);
  (dependencies.print ?? console.log)(JSON.stringify({ passed: allOk, cases: report.cases.length, report_dir: reportDir }));
  return allOk ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
