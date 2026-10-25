/** Checks this Skill's documented frontmatter subset, not general YAML compatibility. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_VERSIONS } from './check_output.ts';

export function read_skill_version(path: string): string {
  const content = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (frontmatter === undefined) throw new Error('Skill YAML frontmatter missing');
  const metadata = /^metadata:\s*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/m.exec(frontmatter)?.[1];
  const version = metadata && /^  version:\s*(["'])([^"'\r\n]+)\1\s*$/m.exec(metadata)?.[2];
  if (!version) throw new Error('Skill metadata.version missing or invalid (quoted scalar required)');
  if (!Array.from(SUPPORTED_VERSIONS).includes(version)) throw new Error('Unsupported Skill metadata.version');
  return version;
}
export function validate_skill(directory: string): string[] {
  const errors: string[] = [], path = join(directory, 'SKILL.md');
  let text: string;
  try { text = readFileSync(path, 'utf8').replace(/^\uFEFF/, ''); read_skill_version(path); }
  catch (error) { return [String(error)]; }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? '';
  if (!/^name: uat-scenario-design\s*$/m.test(frontmatter)) errors.push('Skill name must be uat-scenario-design');
  if (!/^description: \S[^\r\n]*$/m.test(frontmatter)) errors.push('Skill description must be a nonempty single-line scalar');
  for (const script of ['check_output.ts', 'render_output.ts', 'json_compat.ts']) if (!existsSync(join(directory, 'scripts', script))) errors.push('Missing bundled script: ' + script);
  if (!existsSync(join(directory, 'package.json'))) errors.push('Missing bundled package.json');
  const docs = [path];
  const references = join(directory, 'references');
  if (existsSync(references)) for (const name of readdirSync(references)) if (name.endsWith('.md')) docs.push(join(references, name));
  for (const doc of docs) {
    const source = readFileSync(doc, 'utf8');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]!; if (/^(?:https?:|#)/.test(target)) continue;
      if (!existsSync(resolve(dirname(doc), target.split('#')[0]!))) errors.push('Missing local reference: ' + target);
    }
    for (const match of source.matchAll(/\bscripts\/(check_output|render_output)\.ts\b/g)) {
      if (!existsSync(join(directory, 'scripts', match[1] + '.ts'))) errors.push('Missing bundled command: ' + match[0]);
    }
  }
  return errors;
}
export function main(argv = process.argv.slice(2)): number {
  if (argv.length !== 1) { console.error('Usage: node scripts/validate_skill.ts SKILL_DIRECTORY'); return 2; }
  const errors = validate_skill(resolve(argv[0]!));
  console.log(JSON.stringify({ passed: errors.length === 0, scope: 'uat-scenario-design frontmatter subset and local references; not a general YAML validator', errors }, null, 2));
  return errors.length ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
