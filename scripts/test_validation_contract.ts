import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { load, validate } from './check_output.ts';
import { main, read_skill_version } from './run_validation.ts';
import { fixture, output, scratch, save } from './testing_helpers.ts';
test('ValidationContractTests.test_duplicate_entry_id_rejected_even_with_different_text', () => {
  const f = fixture(); f.sources[0].entries.push({ ...f.sources[0].entries[0], text: 'A different requirement sharing the same ID' });
  assert.ok(validate(f, output('A', '0.3'), '0.3').includes('SPEC-A.entries: duplicate id R1'));
});
test('ValidationContractTests.test_missing_or_blank_entry_id_rejected', () => {
  for (const value of [null, '', '  ', 7, []]) {
    const f = fixture(); f.sources[0].entries.push({ id: value, text: 'new' }); assert.ok(validate(f, output('A', '0.3'), '0.3').includes('SPEC-A.entries: missing id'));
  }
  const f = fixture(); f.sources[0].entries.push({ text: 'new' }); assert.ok(validate(f, output('A', '0.3'), '0.3').includes('SPEC-A.entries: missing id'));
});
test('ValidationContractTests.test_same_entry_id_in_different_sources_allowed', () => {
  const f = fixture('G'); assert.equal(f.sources[0].entries[0].id, 'R1'); assert.equal(f.sources[1].entries[0].id, 'R1');
  assert.deepEqual(validate(f, output('G', '0.3'), '0.3'), []);
});
test('ValidationContractTests.test_self_declared_downgrade_cannot_bypass_expected_version', () => {
  const f = fixture(), o = output('A', '0.3'); o.skill_version = '0.1';
  for (const s of o.scenarios) for (const key of ['objective', 'test_data', 'expectation_refs']) delete s[key];
  for (const row of o.coverage) delete row.conditions;
  assert.ok(validate(f, o, '0.4').includes('skill_version mismatch: expected 0.4')); assert.deepEqual(validate(f, o, '0.1'), []);
});
test('ValidationContractTests.test_v04_accepts_rich_contract_and_rejects_missing_objective', () => {
  const f = fixture(), o = output('A', '0.3'); o.skill_version = '0.4'; assert.deepEqual(validate(f, o, '0.4'), []);
  delete o.scenarios[0].objective; assert.ok(validate(f, o, '0.4').includes(o.scenarios[0].id + ': objective missing'));
});
test('ValidationContractTests.test_current_version_is_read_from_skill_metadata', t => {
  const s = scratch(); t.after(s.cleanup); const path = join(s.work, 'sample.md');
  writeFileSync(path, '---\nname: sample\nmetadata:\n  version: "0.4"\n---\n# Body'); assert.equal(read_skill_version(path), '0.4');
});
test('ValidationContractTests.test_missing_or_unsupported_metadata_version_rejected', t => {
  const s = scratch(); t.after(s.cleanup); const path = join(s.work, 'sample.md');
  for (const content of ['# no frontmatter', '---\nname: sample\n---', '---\nmetadata:\n  version: "99"\n---']) {
    writeFileSync(path, content); assert.throws(() => read_skill_version(path));
  }
});
function checkRunner(t: TestContext, version: string, compatibility?: string) {
  const s = scratch(); t.after(s.cleanup); const inputs = join(s.work, 'inputs'), outputs = join(s.work, 'outputs'), reports = join(s.work, 'reports');
  mkdirSync(inputs); mkdirSync(outputs); const o = output('A', '0.3'); o.skill_version = version; save(join(inputs, 'A.json'), fixture()); save(join(outputs, 'A.json'), o);
  const argv = ['--run', outputs, '--fixture-dir', inputs, '--report-dir', reports, '--cases', 'A']; if (compatibility) argv.push('--expected-version', compatibility);
  const commands: string[][] = [];
  const code = main(argv, { readSkillVersion: () => '0.4', execute: command => { commands.push(command); return { exit_code: 0, stdout: '', stderr: '' }; }, print: () => undefined });
  const report = load(join(reports, 'summary.json')) as any; assert.equal(report.fixture_dir, inputs);
  assert.equal(commands.length, 2); assert.ok(commands.every(command => command[0] === process.execPath && command.every(arg => !arg.endsWith('.py'))));
  assert.match(report.cases[0].fixture_sha256, /^[a-f0-9]{64}$/); assert.match(report.cases[0].output_sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.provenance.some((x: { path: string }) => x.path === 'scripts/run_validation.ts'));
  return { code, report };
}
test('ValidationContractTests.test_runner_defaults_to_current_skill_and_accepts_custom_fixture_dir', t => {
  const { code, report } = checkRunner(t, '0.4'); assert.equal(code, 0); assert.equal(report.expected_version, '0.4'); assert.equal(report.version_mode, 'current_skill'); assert.equal(report.passed, true);
});
test('ValidationContractTests.test_runner_rejects_legacy_output_without_explicit_compatibility', t => {
  const { code, report } = checkRunner(t, '0.3'); assert.equal(code, 1); assert.equal(report.passed, false); assert.ok(report.cases[0].errors.includes('skill_version mismatch: expected 0.4'));
});
test('ValidationContractTests.test_runner_explicit_compatibility_accepts_legacy_output', t => {
  const { code, report } = checkRunner(t, '0.3', '0.3'); assert.equal(code, 0); assert.equal(report.expected_version, '0.3'); assert.equal(report.version_mode, 'explicit_compatibility');
});
