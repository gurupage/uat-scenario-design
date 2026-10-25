import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './check_output.ts';
import { fixture, output } from './testing_helpers.ts';
import type { Sample } from './testing_helpers.ts';

function reject(c: string, edit: (o: Sample) => void): void {
  const o = output(c, '0.1'); edit(o);
  assert.ok(validate(fixture(c), o, '0.1').length);
}
test('CheckerTests.test_valid_examples', () => {
  for (const c of 'ABC') assert.deepEqual(validate(fixture(c), output(c, '0.1'), '0.1'), []);
});
test('CheckerTests.test_fabricated_source', () => reject('A', o => o.scenarios[0].source_refs.push('UNKNOWN#R9')));
test('CheckerTests.test_missing_requirement_disposition', () => reject('A', o => o.coverage.pop()));
test('CheckerTests.test_duplicate_scenario_id', () => reject('A', o => o.scenarios.push(structuredClone(o.scenarios[0]))));
test('CheckerTests.test_pending_promoted_to_ready', () => reject('B', o => o.scenarios[0].status = 'ready'));
test('CheckerTests.test_unknown_question', () => reject('C', o => o.scenarios.at(-1).question_ids = ['NOT-FOUND']));
test('CheckerTests.test_missing_expected_result', () => reject('A', o => o.scenarios[0].expected = null));
test('CheckerTests.test_unread_source_claimed_read', () => reject('B', o => o.source_inventory.at(-1).status = 'read'));
test('CheckerTests.test_false_coverage', () => reject('C', o => o.coverage.at(-1).disposition = 'covered'));
test('CheckerTests.test_wrong_scenario_mapping', () => reject('A', o => o.coverage[0].scenario_ids = ['A-10']));
test('CheckerTests.test_malformed_output', () => assert.ok(validate(fixture(), { case_id: 'A' }, '0.1').length));
