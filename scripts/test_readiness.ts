import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { validate } from './check_output.ts';
import { render, code_json } from './render_output.ts';
import { ROOT, fixture, output, scratch, cli } from './testing_helpers.ts';
import type { Sample } from './testing_helpers.ts';
function reject(c: string, edit: (o: Sample) => void): void {
  const o = output(c, '0.3'); edit(o); assert.ok(validate(fixture(c), o, '0.3').length);
}
test('ReadinessTests.test_all_seven_outputs', () => {
  for (const c of 'ABCDEFG') assert.deepEqual(validate(fixture(c), output(c, '0.3'), '0.3'), []);
});
test('ReadinessTests.test_missing_inventory', () => reject('B', o => o.source_inventory = o.source_inventory.slice(0, 1)));
test('ReadinessTests.test_wrong_source_role', () => reject('A', o => o.source_inventory[0].role = 'history'));
test('ReadinessTests.test_missing_objective', () => reject('A', o => delete o.scenarios[0].objective));
test('ReadinessTests.test_wrong_data_shape', () => reject('A', o => o.scenarios[0].test_data = []));
test('ReadinessTests.test_expectation_from_history_only', () => reject('A', o => o.scenarios[0].expectation_refs = ['HISTORY-A1#H2']));
test('ReadinessTests.test_unknown_expectation_source', () => reject('A', o => o.scenarios[0].expectation_refs = ['FAKE#R1']));
test('ReadinessTests.test_unreadable_claimed_read', () => reject('E', o => o.source_inventory.at(-1).status = 'read'));
test('ReadinessTests.test_pending_hidden_in_aggregate', () => reject('C', o => Object.assign(o.coverage.at(-1), { disposition: 'covered', question_ids: [] })));
test('ReadinessTests.test_pending_hidden_in_condition', () => reject('C', o => Object.assign(o.coverage.at(-1).conditions.at(-1), { disposition: 'covered', question_ids: [] })));
test('ReadinessTests.test_excluded_with_scenarios', () => reject('A', o => o.coverage[0].disposition = 'excluded'));
test('ReadinessTests.test_condition_mapping_lost', () => reject('A', o => o.coverage[0].conditions.pop()));
test('ReadinessTests.test_condition_question_lost', () => reject('C', o => o.coverage.at(-1).conditions.at(-1).question_ids = []));
test('ReadinessTests.test_ready_without_observation', () => reject('E', o => Object.assign(o.scenarios.at(-1), { status: 'ready', question_ids: [] })));
test('ReadinessTests.test_no_change_information_stays_empty', () => {
  const o = output('F', '0.3'); assert.deepEqual(o.scenarios, []); assert.deepEqual(o.coverage, []); assert.ok(o.questions.length);
});
test('ReadinessTests.test_no_requirements_without_question_rejected', () => reject('F', o => o.questions = []));
test('ReadinessTests.test_malformed_collections_do_not_crash', () => {
  for (const field of ['source_inventory', 'analysis', 'scenarios', 'questions', 'coverage', 'review'])
    for (const value of [null, 'bad', 9, { unexpected: 'object' }]) reject('A', o => o[field] = value);
});
test('ReadinessTests.test_invisible_and_special_data_round_trip', () => {
  const data = { space: '  ', empty: '', null: null, quantity: 0, markup: '``` <script> | &', literal: 'a\nb' };
  const fenced = code_json(data); assert.deepEqual(JSON.parse(fenced[1]!), data); assert.ok(fenced[0]!.replace(/json$/, '').length > 3);
});
test('ReadinessTests.test_renderer_includes_exact_test_data', () => {
  const md = render(output('E', '0.3'));
  for (const expected of ['"input_note": "  "', '"input_note": ""', 'E-Q2', '要確認']) assert.ok(md.includes(expected));
});
test('ReadinessTests.test_renderer_protects_existing_artifact', t => {
  const s = scratch(); t.after(s.cleanup); const target = join(s.work, 'existing.md'); writeFileSync(target, 'keep me');
  const result = cli(join(ROOT, 'scripts/render_output.ts'), ['--input', join(ROOT, 'evals/samples/v0.3/E.json'), '--output', target]);
  assert.notEqual(result.status, 0); assert.equal(readFileSync(target, 'utf8'), 'keep me');
});
test('ReadinessTests.test_cli_rejects_invalid_json', t => {
  const s = scratch(); t.after(s.cleanup); const bad = join(s.work, 'bad.json'); writeFileSync(bad, '{');
  const result = cli(join(ROOT, 'scripts/check_output.ts'), ['--fixture', join(ROOT, 'evals/fixtures/A.json'), '--output', bad]);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).passed, false);
});
