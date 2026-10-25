/** Validate traceability/readiness. Semantic correctness still needs review. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { direct, equal, load, member, nonempty, object, parseArgs, pyString, required } from './json_compat.ts';
import type { Row } from './json_compat.ts';
export { load };
export const SUPPORTED_VERSIONS = new Set(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7']);
export const DEFAULT_VERSION = '0.7';
const subset = <T>(values: Iterable<T>, allowed: ReadonlySet<T>): boolean => [...values].every(value => allowed.has(value));
const same = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean => a.size === b.size && subset(a, b);
const oneOf = (value: unknown, values: string[]): boolean => member(value, new Set(values));

export function validate(fixture: unknown, output: unknown, expectedVersion?: string): string[] {
  const errors: string[] = [];
  const need = (ok: unknown, message: string): void => { if (!ok) errors.push(message); };
  function rows(value: unknown, label: string): Row[] {
    if (!Array.isArray(value) || !value.every(object)) { errors.push(label + ': must be an array of objects'); return []; }
    return value;
  }
  function strings(value: unknown, label: string, requiredValue = false, unique = true): string[] {
    if (!Array.isArray(value) || !value.every(nonempty)) { errors.push(label + ': must be an array of nonempty strings'); return []; }
    if (unique) need(new Set(value).size === value.length, label + ': duplicates');
    if (requiredValue) need(value.length, label + ': empty');
    return value;
  }
  function indexed(values: Row[], label: string): Map<string, Row> {
    const result = new Map<string, Row>();
    for (const row of values) {
      const key = row.id;
      if (!nonempty(key)) { errors.push(label + ': missing id'); continue; }
      need(!result.has(key), label + ': duplicate id ' + key);
      result.set(key, row);
    }
    return result;
  }
  if (!object(fixture) || !object(output)) return ['fixture and output must be objects'];
  try {
    need(equal(output.case_id, required(fixture, 'case_id')), 'case_id mismatch');
    need(equal(output.data_type, required(fixture, 'data_type')), 'data_type mismatch');
    const version = output.skill_version;
    need(member(version, SUPPORTED_VERSIONS), 'unsupported or missing skill_version');
    if (expectedVersion !== undefined && expectedVersion !== null) {
      need(member(expectedVersion, SUPPORTED_VERSIONS), 'unsupported expected_version');
      need(equal(version, expectedVersion), 'skill_version mismatch: expected ' + pyString(expectedVersion));
    }
    const rich = oneOf(version, ['0.2', '0.3', '0.4', '0.5', '0.6', '0.7']);
    const sources = rows(required(fixture, 'sources'), 'fixture.sources');
    const missing = rows(Object.hasOwn(fixture, 'missing') ? fixture.missing : [], 'fixture.missing');
    const sourceMap = indexed(sources, 'fixture.sources');
    const missingMap = indexed(missing, 'fixture.missing');
    const refs = new Set<string>(), requirements = new Set<string>(), roles = new Map<string, unknown>();
    for (const [sourceId, source] of sourceMap) {
      const label = sourceId + '.entries';
      const entries = indexed(rows(source.entries, label), label);
      for (const entryId of entries.keys()) {
        const ref = sourceId + '#' + entryId;
        refs.add(ref);
        roles.set(ref, required(source, 'role'));
        if (source.role === 'requirement') requirements.add(ref);
      }
    }
    function references(value: unknown, label: string, requiredValue = true): string[] {
      const values = strings(value, label, requiredValue);
      need(subset(values, refs), label + ': unknown reference');
      return values;
    }
    const inventory = indexed(rows(output.source_inventory, 'source_inventory'), 'source_inventory');
    need(same(new Set(inventory.keys()), new Set([...sourceMap.keys(), ...missingMap.keys()])), 'inventory must account for supplied and missing sources');
    for (const [sid, item] of inventory) {
      const expected = sourceMap.get(sid) ?? missingMap.get(sid);
      if (expected) {
        need(equal(item.role, required(expected, 'role')), sid + ': source role mismatch');
        const status = sourceMap.has(sid) ? 'read' : (Object.hasOwn(expected, 'status') ? expected.status : 'missing');
        need(equal(item.status, status), sid + ': source status mismatch');
      }
      need(nonempty(item.note), sid + ': source note missing');
    }
    let analysis = output.analysis;
    if (!object(analysis)) { errors.push('analysis must be an object'); analysis = {}; }
    for (const field of ['scope', 'changes', 'viewpoints', 'history_use']) strings((analysis as Row)[field], 'analysis.' + field, true);
    const questions = indexed(rows(output.questions, 'questions'), 'questions');
    for (const [qid, question] of questions) {
      need(nonempty(question.question) && nonempty(question.impact), qid + ': incomplete question');
      references(question.source_refs, qid + '.source_refs', refs.size > 0);
    }
    const scenarios = indexed(rows(output.scenarios, 'scenarios'), 'scenarios');
    if (!requirements.size) {
      need(!scenarios.size, 'no requirements: do not invent scenarios');
      need(questions.size, 'no requirements: missing information question required');
    }
    const normalized = new Map<string, { status: unknown; reqs: string[]; qids: string[] }>();
    for (const [sid, scenario] of scenarios) {
      need(nonempty(scenario.title), sid + ': missing title');
      need(oneOf(scenario.priority, ['high', 'medium', 'low']) && nonempty(scenario.priority_reason), sid + ': invalid priority');
      const status = scenario.status;
      need(oneOf(status, ['ready', 'pending']), sid + ': invalid status');
      const pre = strings(scenario.preconditions, sid + '.preconditions');
      const steps = strings(scenario.steps, sid + '.steps', false, version !== '0.6' && version !== '0.7');
      const reqs = strings(scenario.requirement_refs, sid + '.requirement_refs', true);
      const evidence = references(scenario.source_refs, sid + '.source_refs');
      const qids = strings(scenario.question_ids, sid + '.question_ids');
      need(subset(reqs, requirements), sid + ': invalid requirement refs');
      need(subset(reqs, new Set(evidence)), sid + ': requirement source missing');
      need(subset(qids, new Set(questions.keys())), sid + ': unknown question');
      const expected = scenario.expected, observation = scenario.observation;
      need(expected == null || nonempty(expected), sid + ': invalid expected');
      need(observation == null || nonempty(observation), sid + ': invalid observation');
      if (status === 'ready') {
        need(pre.length && steps.length && nonempty(expected) && nonempty(observation), sid + ': ready requires executable content');
        need(!qids.length, sid + ': ready has unresolved questions');
      } else if (status === 'pending') need(qids.length, sid + ': pending requires a question');
      if (rich) {
        need(nonempty(scenario.objective), sid + ': objective missing');
        const data = scenario.test_data;
        need(object(data), sid + ': test_data must be an object');
        if (object(data)) need(Object.entries(data).every(([key, value]) => nonempty(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))), sid + ': invalid test_data');
        const expRefs = references(scenario.expectation_refs, sid + '.expectation_refs', status === 'ready');
        need(subset(expRefs, new Set(evidence)), sid + ': expectation reference not in evidence');
        if (status === 'ready') need(expRefs.some(ref => oneOf(roles.get(ref), ['requirement', 'context'])), sid + ': expectation supported only by history/matrix');
      }
      normalized.set(sid, { status, reqs, qids });
    }
    const coverage = rows(output.coverage, 'coverage');
    const crefs = coverage.map(row => row.requirement_ref);
    need(crefs.every(nonempty), 'invalid coverage requirement');
    const validCrefs = crefs.filter(nonempty);
    need(validCrefs.length === new Set(validCrefs).size, 'duplicate coverage requirement');
    need(same(new Set(validCrefs), requirements), 'coverage must account for every input requirement');
    function disposition(row: Row, label: string, ref: unknown): [string[], string[]] {
      const state = row.disposition;
      need(oneOf(state, ['covered', 'pending', 'excluded']), label + ': invalid disposition');
      need(nonempty(row.reason), label + ': reason missing');
      const sids = strings(row.scenario_ids, label + '.scenario_ids');
      const qids = strings(row.question_ids, label + '.question_ids');
      need(subset(sids, new Set(scenarios.keys())), label + ': unknown scenario');
      need(subset(qids, new Set(questions.keys())), label + ': unknown question');
      const linked = sids.flatMap(s => normalized.has(s) ? [normalized.get(s)!] : []);
      need(linked.every(s => s.reqs.some(r => equal(r, ref))), label + ': scenario mapping mismatch');
      const linkedQuestions = new Set(linked.flatMap(s => s.qids));
      if (state === 'covered') {
        need(linked.length && linked.every(s => s.status === 'ready'), label + ': covered must have only ready scenarios');
        need(!qids.length, label + ': covered has unresolved questions');
      } else if (state === 'pending') {
        need(qids.length, label + ': pending requires questions');
        need(subset(linkedQuestions, new Set(qids)), label + ': linked pending questions omitted');
      } else if (state === 'excluded') need(!sids.length && !qids.length, label + ': excluded must not contain scenarios or unresolved questions');
      return [sids, qids];
    }
    for (const row of coverage) {
      const ref = row.requirement_ref, label = pyString(ref);
      const [sids, qids] = disposition(row, label, ref);
      if (rich) {
        const conditions = rows(row.conditions, label + '.conditions');
        need(conditions.length, label + ': conditions missing');
        const labels = conditions.map(c => c.label);
        need(labels.every(nonempty), label + ': condition label missing');
        const validLabels = labels.filter(nonempty);
        need(validLabels.length === new Set(validLabels).size, label + ': duplicate condition label');
        const conditionSids = new Set<string>(), conditionQids = new Set<string>();
        conditions.forEach((condition, i) => {
          const [cs, cq] = disposition(condition, label + '.condition' + i, ref);
          cs.forEach(s => conditionSids.add(s)); cq.forEach(q => conditionQids.add(q));
        });
        need(same(conditionSids, new Set(sids)), label + ': condition/scenario mapping mismatch');
        need(same(conditionQids, new Set(qids)), label + ': condition/question mapping mismatch');
        const states = new Set(conditions.map(c => c.disposition));
        const expectedState = states.has('pending') ? 'pending' : states.has('covered') ? 'covered' : 'excluded';
        need(row.disposition === expectedState, label + ': aggregate disposition mismatch');
      }
    }
    for (const [sid, scenario] of normalized) {
      for (const ref of scenario.reqs) need(coverage.some(c => {
        if (!equal(c.requirement_ref, ref)) return false;
        const ids = Object.hasOwn(c, 'scenario_ids') ? c.scenario_ids : [];
        if (typeof ids === 'string') return ids.includes(sid);
        if (Array.isArray(ids)) return ids.some(id => equal(id, sid));
        if (object(ids)) return Object.hasOwn(ids, sid);
        const type = ids == null ? 'NoneType' : typeof ids === 'boolean' ? 'bool' : typeof ids === 'number' ? Number.isInteger(ids) ? 'int' : 'float' : typeof ids;
        throw new Error("argument of type '" + type + "' is not iterable");
      }), sid + ': reverse coverage mapping missing');
    }
    const review = output.review;
    if (!object(review)) errors.push('review must be an object');
    else {
      need(oneOf(review.status, ['self_reviewed', 'awaiting_review']), 'invalid review status');
      strings(review.limitations, 'review.limitations', true);
    }
  } catch (error) { errors.push('malformed output or fixture: ' + (error instanceof Error ? error.message : String(error))); }
  return errors;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: check_output.ts --fixture FIXTURE --output OUTPUT [--report REPORT] [--expected-version VERSION]\nExpected output version (default: ' + DEFAULT_VERSION + '); set explicitly for legacy output');
    return 0;
  }
  let args: Record<string, string>;
  try {
    args = parseArgs(argv, ['--fixture', '--output'], ['--report', '--expected-version']);
    args['--expected-version'] ??= DEFAULT_VERSION;
    if (!SUPPORTED_VERSIONS.has(args['--expected-version']!)) throw new Error('argument --expected-version: invalid choice: ' + args['--expected-version']);
  } catch (error) { console.error(String(error)); return 2; }
  let errors: string[];
  try { errors = validate(load(args['--fixture']!), load(args['--output']!), args['--expected-version']); }
  catch (error) { console.log(JSON.stringify({ passed: false, errors: [error instanceof Error ? error.message : String(error)] })); return 1; }
  try {
    const report = { passed: !errors.length, errors, expected_version: args['--expected-version'], fixture_sha256: createHash('sha256').update(readFileSync(args['--fixture']!)).digest('hex'), output_sha256: createHash('sha256').update(readFileSync(args['--output']!)).digest('hex'), scope: 'structural and reference validation only; no semantic judgment' };
    const body = JSON.stringify(report, null, 2);
    if (args['--report']) writeFileSync(args['--report'], body, { encoding: 'utf8', flag: 'wx' });
    console.log(body);
    return errors.length ? 1 : 0;
  } catch (error) { console.error(String(error)); return 1; }
}
if (direct(import.meta.url)) process.exitCode = main();
