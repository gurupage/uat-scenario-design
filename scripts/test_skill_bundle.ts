import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as checker from './check_output.ts';
import * as renderer from './render_output.ts';
import * as bundledChecker from '../skills/uat-scenario-design/scripts/check_output.ts';
import * as bundledRenderer from '../skills/uat-scenario-design/scripts/render_output.ts';
import { ROOT, BUNDLE, fixture, output, scratch, save, cli } from './testing_helpers.ts';

function setup(t: TestContext) {
  const s = scratch(); t.after(s.cleanup);
  const scripts = join(s.work, 'standalone-skill/scripts');
  cpSync(BUNDLE, scripts, { recursive: true, filter: source => !source.includes('__pycache__') && !source.endsWith('.py') });
  const f = fixture(), o = output(); o.skill_version = '0.7';
  const fp = join(s.work, 'input.json'), op = join(s.work, 'output.json');
  const persist = () => { save(fp, f); save(op, o); }; persist();
  const check = (script = join(scripts, 'check_output.ts'), args: string[] = []) => {
    const result = cli(script, ['--fixture', fp, '--output', op, ...args], s.work);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return { result, report: JSON.parse(result.stdout) };
  };
  return { ...s, scripts, f, o, fp, op, persist, check };
}
test('SkillBundleTests.test_standalone_bundle_checks_and_renders', t => {
  const s = setup(t), rp = join(s.work, 'report.json'); const { result, report } = s.check(undefined, ['--report', rp]);
  assert.equal(result.status, 0, result.stderr); assert.equal(report.passed, true); assert.equal(report.expected_version, '0.7');
  assert.deepEqual(report, checker.load(rp)); const md = join(s.work, 'scenarios.md');
  const shown = cli(join(s.scripts, 'render_output.ts'), ['--input', s.op, '--output', md], s.work);
  assert.equal(shown.status, 0, shown.stderr); assert.equal(readFileSync(md, 'utf8'), renderer.render(s.o));
});
test('SkillBundleTests.test_wrapper_and_standalone_cli_are_equivalent', t => {
  const s = setup(t);
  for (const version of ['0.7', '0.4']) {
    s.o.skill_version = version; s.persist(); const args = version === '0.7' ? [] : ['--expected-version', version];
    const a = s.check(undefined, args), b = s.check(join(ROOT, 'scripts/check_output.ts'), args);
    assert.equal(a.result.status, b.result.status); assert.deepEqual(a.report, b.report);
  }
  const a = join(s.work, 'standalone.md'), b = join(s.work, 'wrapper.md');
  for (const [script, target] of [[join(s.scripts, 'render_output.ts'), a], [join(ROOT, 'scripts/render_output.ts'), b]]) {
    const result = cli(script!, ['--input', s.op, '--output', target!], s.work); assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(readFileSync(a), readFileSync(b));
});
test('SkillBundleTests.test_wrapper_exports_execute_bundled_implementation', () => {
  assert.equal(checker.load, bundledChecker.load); assert.equal(checker.validate, bundledChecker.validate);
  assert.equal(renderer.render, bundledRenderer.render); assert.equal(renderer.code_json, bundledRenderer.code_json); assert.equal(renderer.plain, bundledRenderer.plain);
  for (const version of ['0.5', '0.6', '0.7']) assert.ok(Array.from(checker.SUPPORTED_VERSIONS).includes(version));
  assert.equal(checker.DEFAULT_VERSION, '0.7');
});
test('SkillBundleTests.test_cli_downgrade_cannot_bypass_current_contract', t => {
  const s = setup(t); save(s.op, output('A', '0.1'));
  for (const script of [join(s.scripts, 'check_output.ts'), join(ROOT, 'scripts/check_output.ts')]) {
    const { result, report } = s.check(script); assert.equal(result.status, 1); assert.equal(report.passed, false);
    assert.ok(report.errors.includes('skill_version mismatch: expected 0.7'));
  }
});
test('SkillBundleTests.test_explicit_legacy_cli_and_unspecified_api_remain_compatible', t => {
  const s = setup(t), old = output('A', '0.1'); save(s.op, old); assert.deepEqual(checker.validate(s.f, old), []);
  const { result, report } = s.check(undefined, ['--expected-version', '0.1']);
  assert.equal(result.status, 0); assert.equal(report.passed, true); assert.equal(report.expected_version, '0.1');
});
test('SkillBundleTests.test_v05_rejects_each_rich_required_field_omission', t => {
  const s = setup(t); s.o.skill_version = '0.5'; const sid = s.o.scenarios[0].id, ref = s.o.coverage[0].requirement_ref;
  for (const [field, error] of [['objective', sid + ': objective missing'], ['test_data', sid + ': test_data must be an object'], ['expectation_refs', sid + '.expectation_refs: must be an array of nonempty strings'], ['conditions', ref + ': conditions missing']]) {
    const o = structuredClone(s.o); delete (field === 'conditions' ? o.coverage[0] : o.scenarios[0])[field!]; save(s.op, o);
    const { result, report } = s.check(undefined, ['--expected-version', '0.5']); assert.equal(result.status, 1); assert.ok(report.errors.includes(error));
  }
});
test('SkillBundleTests.test_reverse_coverage_omission_detected_in_standalone_cli', t => {
  const s = setup(t), sid = s.o.scenarios[0].id;
  for (const row of s.o.coverage) { row.scenario_ids = row.scenario_ids.filter((x: string) => x !== sid); for (const c of row.conditions) c.scenario_ids = c.scenario_ids.filter((x: string) => x !== sid); }
  s.persist(); const { result, report } = s.check(); assert.equal(result.status, 1); assert.ok(report.errors.includes(sid + ': reverse coverage mapping missing'));
});
test('SkillBundleTests.test_requirement_meta_needs_explicit_coverage_disposition', t => {
  const s = setup(t), source = s.f.sources.find((x: { role: string }) => x.role === 'requirement');
  source.entries.push({ id: 'META', text: 'Document date; not a testable requirement.' }); s.persist();
  const bad = s.check(); assert.equal(bad.result.status, 1); assert.ok(bad.report.errors.includes('coverage must account for every input requirement'));
  const excluded = { disposition: 'excluded', reason: 'Document metadata has no business acceptance condition.', scenario_ids: [], question_ids: [] };
  s.o.coverage.push({ ...excluded, requirement_ref: source.id + '#META', conditions: [{ ...excluded, label: 'Document metadata' }] }); s.persist();
  const good = s.check(); assert.equal(good.result.status, 0, JSON.stringify(good.report.errors));
});
test('SkillBundleTests.test_standalone_report_does_not_overwrite_previous_evidence', t => {
  const s = setup(t), rp = join(s.work, 'existing.json'); writeFileSync(rp, 'preserve previous evidence');
  const result = cli(join(s.scripts, 'check_output.ts'), ['--fixture', s.fp, '--output', s.op, '--report', rp], s.work);
  assert.notEqual(result.status, 0); assert.equal(readFileSync(rp, 'utf8'), 'preserve previous evidence');
});
test('SkillBundleTests.test_v05_accepts_all_seven_existing_contract_examples', () => {
  for (const c of 'ABCDEFG') { const o = output(c); o.skill_version = '0.5'; assert.deepEqual(checker.validate(fixture(c), o, '0.5'), []); }
});
