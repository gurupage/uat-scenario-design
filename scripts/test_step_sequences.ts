import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { validate } from './check_output.ts';
import { render, plain } from './render_output.ts';
import { ROOT, BUNDLE, fixture, output, scratch, save, cli } from './testing_helpers.ts';
const steps = ['日本語から英語へ切り替える', '表示内容を記録する', '英語から日本語へ戻す', '表示内容を記録する'];
function setup(version = '0.7') { const f = fixture(), o = output(); o.skill_version = version; o.scenarios[0].steps = [...steps]; return { f, o, sid: o.scenarios[0].id }; }
test('StepSequenceTests.test_separated_repetition_is_accepted_without_mutation', () => {
  for (const v of ['0.6', '0.7']) { const { f, o } = setup(v), before = structuredClone(o); assert.deepEqual(validate(f, o, v), []); assert.deepEqual(o, before); assert.deepEqual(o.scenarios[0].steps, steps); }
});
test('StepSequenceTests.test_adjacent_repetition_is_also_an_ordered_sequence', () => {
  for (const v of ['0.6', '0.7']) { const { f, o } = setup(v); o.scenarios[0].steps = [steps[1], steps[1]]; assert.deepEqual(validate(f, o, v), []); }
});
test('StepSequenceTests.test_all_legacy_versions_retain_duplicate_rejection', () => {
  for (const v of ['0.1', '0.2', '0.3', '0.4', '0.5']) { const { f, o, sid } = setup(v); assert.deepEqual(validate(f, o, v), [sid + '.steps: duplicates']); assert.deepEqual(validate(f, o), [sid + '.steps: duplicates']); }
});
test('StepSequenceTests.test_empty_ready_operation_list_still_rejected', () => {
  const { f, o, sid } = setup(); o.scenarios[0].steps = []; assert.ok(validate(f, o, '0.7').includes(sid + ': ready requires executable content'));
});
test('StepSequenceTests.test_malformed_and_blank_steps_still_rejected', () => {
  for (const v of ['0.6', '0.7']) for (const value of [null, 'single string', {}, [''], ['  '], ['ok', null], ['ok', 2], ['ok', ['nested']], ['ok', 'ok', '\t']]) {
    const { f, o, sid } = setup(v); o.scenarios[0].steps = value; assert.ok(validate(f, o, v).includes(sid + '.steps: must be an array of nonempty strings'));
  }
});
test('StepSequenceTests.test_reference_and_mapping_lists_still_reject_duplicates', () => {
  for (const v of ['0.6', '0.7']) for (const c of ['A', 'C']) {
    const f = fixture(c), original = output(c); original.skill_version = v; assert.deepEqual(validate(f, original, v), []);
    const paths: (string | number)[][] = [];
    original.scenarios.forEach((s: Record<string, any>, i: number) => { for (const key of ['requirement_refs', 'source_refs', 'expectation_refs', 'question_ids', 'preconditions']) if (s[key].length) paths.push(['scenarios', i, key]); });
    original.coverage.forEach((r: Record<string, any>, i: number) => {
      for (const key of ['scenario_ids', 'question_ids']) if (r[key].length) paths.push(['coverage', i, key]);
      r.conditions.forEach((x: Record<string, any>, j: number) => { for (const key of ['scenario_ids', 'question_ids']) if (x[key].length) paths.push(['coverage', i, 'conditions', j, key]); });
    });
    original.questions.forEach((q: Record<string, any>, i: number) => { if (q.source_refs.length) paths.push(['questions', i, 'source_refs']); });
    for (const path of paths) { const o = structuredClone(original); let target: any = o; for (const key of path) target = target[key]; target.push(target[0]); assert.ok(validate(f, o, v).some(e => e.includes(': duplicates')), path.join('.')); }
  }
});
test('StepSequenceTests.test_duplicate_scenario_and_source_ids_still_rejected', () => {
  const { f, o, sid } = setup(); o.scenarios.push(structuredClone(o.scenarios[0])); f.sources[0].entries.push(structuredClone(f.sources[0].entries[0]));
  const errors = validate(f, o, '0.7'); assert.ok(errors.includes('scenarios: duplicate id ' + sid)); assert.ok(errors.some(e => e.includes('.entries: duplicate id ')));
});
test('StepSequenceTests.test_other_errors_are_retained_with_repeated_steps', () => {
  const { f, o, sid } = setup(); o.scenarios[0].source_refs.push('UNKNOWN#R1'); delete o.scenarios[0].objective;
  const errors = validate(f, o, '0.7'); assert.ok(errors.includes(sid + '.source_refs: unknown reference')); assert.ok(errors.includes(sid + ': objective missing')); assert.ok(!errors.includes(sid + '.steps: duplicates'));
});
test('StepSequenceTests.test_current_rich_fields_remain_required', () => {
  for (const v of ['0.6', '0.7']) for (const key of ['objective', 'test_data', 'expectation_refs', 'conditions']) { const { f, o } = setup(v); delete (key === 'conditions' ? o.coverage[0] : o.scenarios[0])[key]; assert.ok(validate(f, o, v).length); }
});
test('StepSequenceTests.test_cli_and_renderer_preserve_order_and_repetition', t => {
  const s = scratch(); t.after(s.cleanup); const { o } = setup(), op = join(s.work, 'output.json'); save(op, o); const before = readFileSync(op);
  for (const [i, scripts] of [join(ROOT, 'scripts'), BUNDLE].entries()) {
    const check = cli(join(scripts, 'check_output.ts'), ['--fixture', join(ROOT, 'evals/fixtures/A.json'), '--output', op]);
    assert.equal(check.status, 0, check.stderr + check.stdout); const report = JSON.parse(check.stdout); assert.equal(report.passed, true); assert.equal(report.expected_version, '0.7');
    const target = join(s.work, `${i}.md`), shown = cli(join(scripts, 'render_output.ts'), ['--input', op, '--output', target]);
    assert.equal(shown.status, 0, shown.stderr); const md = readFileSync(target, 'utf8');
    assert.ok(md.includes(steps.map((x, n) => `${n + 1}. ${plain(x)}`).join('\n'))); assert.equal(md, render(o)); assert.deepEqual(readFileSync(op), before);
  }
});
test('StepSequenceTests.test_current_version_accepts_seven_saved_examples', () => {
  for (const v of ['0.6', '0.7']) for (const c of 'ABCDEFG') { const o = output(c); o.skill_version = v; assert.deepEqual(validate(fixture(c), o, v), []); }
});
