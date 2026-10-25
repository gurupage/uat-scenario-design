import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { load } from './check_output.ts';
import { main } from './run_validation.ts';
import { validate_skill } from './validate_skill.ts';
import { ROOT, fixture, output, scratch, save, cli } from './testing_helpers.ts';
function setup(t: TestContext) {
  const s = scratch(); t.after(s.cleanup); const inputs = join(s.work, 'inputs'), outputs = join(s.work, 'outputs'), reports = join(s.work, 'reports');
  mkdirSync(inputs); mkdirSync(outputs); const o = output(); o.skill_version = '0.7'; save(join(inputs, 'A.json'), fixture()); save(join(outputs, 'A.json'), o);
  const argv = ['--run', outputs, '--fixture-dir', inputs, '--report-dir', reports, '--cases', 'A'];
  return { ...s, inputs, outputs, reports, argv };
}
const dependencies = { readSkillVersion: () => '0.7', execute: () => ({ exit_code: 0, stdout: '', stderr: '' }), print: () => undefined };
test('RunnerGuards.existing_report_directory_and_output_run_are_protected', t => {
  const s = setup(t); mkdirSync(s.reports); const evidence = join(s.reports, 'evidence.txt'); writeFileSync(evidence, 'keep');
  assert.throws(() => main(s.argv, dependencies), /EEXIST/); assert.equal(readFileSync(evidence, 'utf8'), 'keep');
  const before = readFileSync(join(s.outputs, 'A.json')); const args = [...s.argv]; args[5] = s.outputs;
  assert.throws(() => main(args, dependencies), /EEXIST/); assert.deepEqual(readFileSync(join(s.outputs, 'A.json')), before); assert.equal(existsSync(join(s.outputs, 'summary.json')), false);
});
test('RunnerGuards.path_traversal_and_duplicate_cases_rejected_before_report_creation', t => {
  const s = setup(t);
  for (const cases of ['../A', 'A/A', 'A\\A', 'A,A']) {
    const args = [...s.argv]; args[7] = cases; assert.throws(() => main(args, dependencies)); assert.equal(existsSync(s.reports), false);
  }
});
test('RunnerGuards.empty_case_selection_is_not_a_pass', t => {
  const s = setup(t); const args = [...s.argv]; args[7] = ', ,'; assert.equal(main(args, dependencies), 1);
  const summary = load(join(s.reports, 'summary.json')) as any; assert.equal(summary.passed, false); assert.deepEqual(summary.cases, []);
});
test('RunnerGuards.missing_fixture_is_failed_evidence_and_no_markdown', t => {
  const s = setup(t); save(join(s.outputs, 'B.json'), output('B')); const args = [...s.argv]; args[7] = 'B'; assert.equal(main(args, dependencies), 1);
  const summary = load(join(s.reports, 'summary.json')) as any; assert.equal(summary.cases[0].passed, false); assert.ok(summary.cases[0].errors.length); assert.equal(existsSync(join(s.reports, 'B.md')), false);
});
test('RunnerGuards.child_command_failure_and_timeout_are_failed_evidence', t => {
  const s = setup(t); let calls = 0;
  assert.equal(main(s.argv, { ...dependencies, execute: () => { calls++; if (calls === 1) return { exit_code: 7, stdout: 'test failure', stderr: 'details' }; throw new Error('timeout'); } }), 1);
  const summary = load(join(s.reports, 'summary.json')) as any; assert.equal(summary.cases[0].passed, true); assert.equal(summary.passed, false);
  assert.equal(summary.commands[0].exit_code, 7); assert.equal(summary.commands[1].exit_code, -1); assert.match(summary.commands[1].stderr, /timeout/);
  assert.equal(readFileSync(join(s.reports, 'tests.txt'), 'utf8'), 'test failuredetails');
});
test('RunnerGuards.hashes_identify_exact_inputs_and_source', t => {
  const s = setup(t); assert.equal(main(s.argv, dependencies), 0); const summary = load(join(s.reports, 'summary.json')) as any;
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(summary.cases[0].fixture_sha256, sha(join(s.inputs, 'A.json'))); assert.equal(summary.cases[0].output_sha256, sha(join(s.outputs, 'A.json')));
  assert.equal(summary.provenance.find((p: { path: string }) => p.path === 'scripts/run_validation.ts').sha256, sha(join(ROOT, 'scripts/run_validation.ts')));
});
test('RunnerGuards.runtime_rejects_python_validator_and_unknown_version', t => {
  const s = setup(t);
  for (const extra of [['--skill-validator', 'quick_validate.py'], ['--expected-version', '99']]) { assert.throws(() => main([...s.argv, ...extra], dependencies)); assert.equal(existsSync(s.reports), false); }
});
test('RunnerGuards.skill_format_checks_metadata_name_description_and_local_targets', t => {
  const s = scratch(); t.after(s.cleanup); const skill = join(s.work, 'skill');
  cpSync(join(ROOT, 'skills/uat-scenario-design'), skill, { recursive: true, filter: path => !path.includes('__pycache__') });
  assert.deepEqual(validate_skill(skill), []); const path = join(skill, 'SKILL.md'), original = readFileSync(path, 'utf8');
  for (const [content, pattern] of [
    [original.replace('name: uat-scenario-design', 'name: wrong'), /Skill name/],
    [original.replace(/^description:.*$/m, 'description: '), /Skill description/],
    [original.replace('version: "0.7"', 'version: "99"'), /Unsupported/],
    [original + '\n[Missing](references/not-there.md)\n', /Missing local reference/],
  ] as const) { writeFileSync(path, content); assert.ok(validate_skill(skill).some(e => pattern.test(e)), String(pattern)); }
});
test('RunnerGuards.cli_returns_failure_without_overwriting_evidence', t => {
  const s = setup(t); mkdirSync(s.reports); const evidence = join(s.reports, 'saved.txt'); writeFileSync(evidence, 'keep');
  const result = cli(join(ROOT, 'scripts/run_validation.ts'), s.argv); assert.equal(result.status, 1); assert.equal(readFileSync(evidence, 'utf8'), 'keep');
});
test('RunnerGuards.skill_format_rejects_missing_json_compat', t => {
  const s = scratch(); t.after(s.cleanup); const skill = join(s.work, 'skill');
  const source = join(ROOT, 'skills/uat-scenario-design'), omitted = join(source, 'scripts/json_compat.ts');
  cpSync(source, skill, { recursive: true, filter: path => path !== omitted && !path.includes('__pycache__') });
  assert.equal(existsSync(join(skill, 'scripts/json_compat.ts')), false);
  assert.ok(validate_skill(skill).includes('Missing bundled script: json_compat.ts'));
  const result = cli(join(ROOT, 'scripts/validate_skill.ts'), [skill]);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).passed, false);
});
test('RunnerGuards.skill_format_rejects_missing_package_manifest', t => {
  const s = scratch(); t.after(s.cleanup); const skill = join(s.work, 'skill');
  const source = join(ROOT, 'skills/uat-scenario-design'), omitted = join(source, 'package.json');
  cpSync(source, skill, { recursive: true, filter: path => path !== omitted && !path.includes('__pycache__') });
  assert.equal(existsSync(join(skill, 'package.json')), false);
  assert.ok(validate_skill(skill).includes('Missing bundled package.json'));
  const result = cli(join(ROOT, 'scripts/validate_skill.ts'), [skill]);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).passed, false);
});
