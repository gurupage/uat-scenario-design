/** Render saved scenarios without hiding pending items or literal test data. */
import { writeFileSync } from 'node:fs';
import { direct, jsonBody, load, object, parseArgs, pyString, required, truth } from './json_compat.ts';
import type { Row } from './json_compat.ts';
export { load };
export function plain(value: unknown): string {
  return pyString(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\n/g, ' ');
}
export function code_json(value: unknown): string[] {
  const body = jsonBody(value);
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [fence + 'json', body, fence];
}
function asRow(value: unknown): Row {
  if (!object(value)) throw new Error('Expected an object');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array');
  return value;
}
function join(value: unknown): string {
  const values = array(value);
  if (!values.every(item => typeof item === 'string')) throw new Error('Expected an array of strings');
  return values.join(', ');
}
function lookup(table: Record<string, string>, key: unknown): string {
  if (typeof key !== 'string' || !Object.hasOwn(table, key)) throw new Error('Unknown value: ' + pyString(key));
  return table[key]!;
}
export function render(value: unknown): string {
  const data = asRow(value);
  const scenarios = array(required(data, 'scenarios')).map(asRow);
  const state: Record<string, string> = { ready: '設計済み', pending: '要確認' };
  const priority: Record<string, string> = { high: '高', medium: '中', low: '低' };
  const lines = ['# UATシナリオ ' + plain(required(data, 'case_id')), '',
    'Skill ' + plain(required(data, 'skill_version')) + ' / ' + plain(required(data, 'data_type')) + ' / 未承認・テスト未実行', '',
    '設計済みは資料上の準備状態を示します。実施済み・承認済みではありません。', '',
    '## シナリオ一覧', '', '|ID|シナリオ|状態|優先度|', '|---|---|---|---|'];
  for (const s of scenarios) lines.push(`|${plain(required(s, 'id'))}|${plain(required(s, 'title'))}|${lookup(state, required(s, 'status'))}|${lookup(priority, required(s, 'priority'))}|`);
  if (!scenarios.length) lines.push('', 'シナリオ0件。入力不足等の理由は確認事項に記載しています。');
  for (const s of scenarios) {
    lines.push('', `## ${plain(required(s, 'id'))} ${plain(required(s, 'title'))}`, '',
      `状態：${lookup(state, required(s, 'status'))} / 優先度：${lookup(priority, required(s, 'priority'))}（${plain(required(s, 'priority_reason'))}）`);
    if (Object.hasOwn(s, 'objective')) lines.push('', '**確認目的**：' + plain(s.objective));
    lines.push('', '**前提条件**', '');
    lines.push(...array(required(s, 'preconditions')).map(x => '- ' + plain(x)));
    if (Object.hasOwn(s, 'test_data')) {
      lines.push('', '**テストデータ**（引用符の内側の空白・空文字を保持）', '');
      lines.push(...code_json(s.test_data));
    }
    lines.push('', '**操作**', '');
    lines.push(...array(required(s, 'steps')).map((x, i) => `${i + 1}. ${plain(x)}`));
    const expected = required(s, 'expected'), observation = required(s, 'observation');
    const sourceRefs = required(s, 'source_refs');
    lines.push('', '**期待結果**：' + plain(truth(expected) ? expected : '未確定。確認事項が解消するまで実行対象にしない。'),
      '', '**観測方法**：' + plain(truth(observation) ? observation : '未確定'),
      '', '**期待結果の根拠**：' + (plain(join(Object.hasOwn(s, 'expectation_refs') ? s.expectation_refs : sourceRefs)) || '未確定'),
      '', '**関連資料**：' + plain(join(sourceRefs)),
      '', '**確認事項**：' + plain(join(required(s, 'question_ids')) || 'なし'));
  }
  lines.push('', '## 確認事項', '');
  const questions = array(required(data, 'questions')).map(asRow);
  for (const q of questions) lines.push(`- **${plain(required(q, 'id'))}**：${plain(required(q, 'question'))} / 影響：${plain(required(q, 'impact'))} / 根拠：${plain(join(required(q, 'source_refs')))}`);
  if (!questions.length) lines.push('提供資料の記載範囲ではなし。実環境での実行可能性は未確認。');
  lines.push('', '## 根拠・設計の補足', '', '### 入力資料', '');
  for (const item of array(required(data, 'source_inventory')).map(asRow)) lines.push(`- ${plain(required(item, 'id'))} (${plain(required(item, 'status'))}): ${plain(required(item, 'note'))}`);
  for (const [key, title] of [['scope', '範囲'], ['changes', '変更・影響'], ['viewpoints', '観点と選択理由'], ['history_use', '過去例の扱い']] as const) {
    lines.push('', '### ' + title, '');
    lines.push(...array(required(asRow(required(data, 'analysis')), key)).map(item => '- ' + plain(item)));
  }
  lines.push('', '### 要件と確認条件の対応', '');
  for (const c of array(required(data, 'coverage')).map(asRow)) {
    lines.push(`- **${plain(required(c, 'requirement_ref'))}**：${plain(required(c, 'disposition'))} — ${plain(required(c, 'reason'))}`);
    for (const condition of array(Object.hasOwn(c, 'conditions') ? c.conditions : []).map(asRow)) {
      lines.push(`  - ${plain(required(condition, 'label'))}：${plain(required(condition, 'disposition'))} / シナリオ：${plain(join(required(condition, 'scenario_ids')) || 'なし')} / 質問：${plain(join(required(condition, 'question_ids')) || 'なし')} / ${plain(required(condition, 'reason'))}`);
    }
    if (!truth(c.conditions)) lines.push('  - シナリオ：' + plain(join(required(c, 'scenario_ids'))) + ' / 質問：' + plain(join(required(c, 'question_ids'))));
  }
  lines.push('', '## レビューの状態と限界', '');
  lines.push(...array(required(asRow(required(data, 'review')), 'limitations')).map(x => '- ' + plain(x)));
  return lines.join('\n') + '\n';
}
export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.includes('--help') || argv.includes('-h')) { console.log('usage: render_output.ts --input INPUT --output OUTPUT'); return 0; }
  let args: Record<string, string>;
  try { args = parseArgs(argv, ['--input', '--output']); }
  catch (error) { console.error(String(error)); return 2; }
  try {
    const result = render(load(args['--input']!));
    writeFileSync(args['--output']!, result, { encoding: 'utf8', flag: 'wx' });
    console.log(args['--output']);
    return 0;
  } catch (error) { console.error(String(error)); return 1; }
}
if (direct(import.meta.url)) process.exitCode = main();
