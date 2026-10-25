# 出力とチェック v0.7

## 人が確認する内容

- 資料一覧：読んだ資料・版・未受領。根拠は参照IDと場所を残す。
- 現場範囲：観点表と過去例の共通点/差分、採用/候補/除外の理由。
- 変更/影響/観点：中間判断を短く残す。
- シナリオ：ID、目的、優先度と理由、前提/データ、操作、期待結果、観測方法、根拠、状態。
- 要件対応：シナリオ対応、保留、対象外と理由。単純な行数やID対応率だけで意味上の網羅性を主張しない。
- 確認事項：質問、理由、根拠、影響するシナリオ。回答がない部分の期待結果は未確定のまま。
- レビュー：AIの自己点検とレビュー担当者の確認を区別する。未実行・実資料未評価などの限界も記す。

## 原資料の索引

原本を残し、AIが `source-index.json` を作る。利用者に前処理を要求しない。

```json
{"case_id":"案件ID","data_type":"synthetic","sources":[{"id":"資料ID","role":"requirement","entries":[{"id":"項目ID","text":"原文から読み取った条件","locator":"ファイル名・見出し・表の行など"}]}],"missing":[]}
```

実資料ではdata_typeはreal。sourcesは読めた資料、missingは `{id,role,status,note}` の配列（statusはmissing/unreadable）。一つの原本に仕様・観点表・過去例が混在する場合は論理的に分割し、locatorで同じ原本へ戻れるようにする。idは資料内で一意にする。

requirementのentriesは今回の要件と未確定要件を列挙する。版・作成日などのメタ情報は資料属性や台帳へ記録し、要件に混ぜない。関連仕様はcontext、工程定義はmatrix、過去例はhistory。読み落としや検査回避のために現行要件をcontextへ移したり、要件・条件を消したりしない。索引の条件・例外・否定・脚注が原文と一致するかは別途照合する。

## JSON形式

トップレベルに `case_id`, `skill_version`, `data_type`（synthetic/real）, `source_inventory`, `analysis`, `scenarios`, `coverage`, `questions`, `review` を持つ。

- `source_inventory`: `{id, role, status, note}` の配列。roleはrequirement/matrix/history/context、statusはread/missing/unreadable。架空fixtureではsourcesにある全資料をread、missingにある全資料を指定された状態（既定missing）で記録し、省略しない。観点表を読めたがUAT欄がない場合はreadとし、その内容をnoteに書く。
- `analysis`: `{scope, changes, viewpoints, history_use}`。各値は文字列配列。資料参照や選択理由を簡潔に含める。
- `scenarios`: `{id, title, objective, priority, priority_reason, status, preconditions, test_data, steps, expected, observation, requirement_refs, source_refs, expectation_refs, question_ids}` の配列。
  - objectiveは確認目的。test_dataは項目名と値のオブジェクトで、値は文字列/数値/真偽値/null。値が不明なら勝手に埋めない。文字列の前後空白と空文字を保持し、表示時にも区別できるようにする。
  - 検査・表示スクリプトは、非有限数と安全な整数範囲（±9,007,199,254,740,991）を超える整数値を拒否する。値を黙って丸めたり、検査を通すために数値を文字列へ置き換えたりしない。資料の値と扱いを確認する。
  - priorityはhigh/medium/low、statusはready/pending。
  - preconditions, steps, requirement_refs, source_refs, question_idsは配列。
  - stepsは順序を持つ操作列で同じ操作の反復を許すが、ID・参照・対応リストの重複は許さない。
  - source_refsは `資料ID#項目ID`。requirement_refsはそのシナリオが確認する今回要件の同形式。一般的な前提や補助情報はsource_refsに置き、確認しない要件をrequirement_refsへ機械的に付けない。
  - expectation_refsは期待動作の根拠に使う参照でsource_refsの部分集合。readyなら今回仕様または有効な関連仕様（context）の根拠を含める。観点表/過去例しかない動作を現行仕様と断定しない。pendingで期待結果が不明なら空配列でよい。
  - expectedは文字列、期待結果が不明ならnull。readyは前提/操作/期待結果/観測方法/根拠を持ち、未解決question_idsを持たない。pendingは質問を参照し、自動実行対象にしない。
- `coverage`: `{requirement_ref, disposition, scenario_ids, question_ids, reason, conditions}`。dispositionはcovered/pending/excluded。索引内のrequirementに属する全項目を1件ずつ網羅する。各シナリオのrequirement_refsにある全要件のcoverageにもそのシナリオIDが必要であり、逆方向も一致させる。
  - conditionsは `{label, disposition, scenario_ids, question_ids, reason}` の配列。要件に含まれる役割/状態/条件/観測先を、確認できる単位に分ける。意味上の抽出漏れは別途原文との照合で確認する。
  - coveredは関連シナリオがすべてreadyで、未解決質問がない。pendingには質問が必要。excludedには理由が必要で、関連シナリオや未解決質問を混在させない。
  - 要件単位のscenario_ids/question_idsはconditionsの和集合。条件が1つでもpendingなら全体pending、そうでなくcoveredがあればcovered、すべてexcludedなら全体excluded。
- `questions`: `{id, question, impact, source_refs}`。前提・操作で認識した未確定事項も質問へ対応付ける。質問はまとめて提示し、AIが回答済みにしない。
- `review`: `{status, limitations}`。statusはself_reviewedまたはawaiting_review。レビュー担当者が確認したという意味にしない。

変更要件が得られないときはシナリオ0件とし、必要な資料と影響をquestionsに残す。期待結果が既知でも判定方法が未確定ならobservationはnull、statusはpendingとする。単に観測先の名前が書かれているだけでは判定可能とみなさない。独立して判定できる条件が同じシナリオの未確定条件に巻き込まれる場合はシナリオを分ける。

現場の原本をこの形式に整えるとき、表/図/条件の読み落としも別途確認する。付属checkerは参照関係と状態を検査するだけで、原文からの抽出漏れ、期待結果の意味上の正しさ、観点の十分性は判定しない。

## 人向けの表示順

案件の短い説明とシナリオ一覧→各シナリオ（確認目的・前提・データ・操作・期待結果・根拠）→まとめた確認事項→範囲/分析/要件対応の補足。この順で、レビュー対象を先に読める形にする。保留と設計済みを明示し、承認済み・実施済みと表現しない。

## 提出前の検査と修正

Node.js 22.18以上の22系、または24以降でSkill内のTypeScriptスクリプトを直接実行する（検査・表示の追加パッケージ不要）。以下の `<skill>` と `<run>` は実際の絶対パスに置き換える。Windowsでは利用可能なNode.jsの実行ファイルを使う。Skillフォルダ全体をコピーすれば単独利用できる。

1. 索引と出力草稿 `draft-01.json` を新規保存し、原文と条件・期待結果・観測方法・保留範囲を自己点検する。
2. 次を実行し、検査結果を保存する。

```text
node "<skill>/scripts/check_output.ts" --fixture "<run>/source-index.json" --output "<run>/draft-01.json" --expected-version 0.7 --report "<run>/check-01.json"
```

3. エラーがあれば元草稿と検査結果を残し、意味を維持した修正版 `draft-02.json` 等で再検査する。参照の修正に伴い要件対応の双方向とconditionsの和集合もそろえる。実際の要件を削ったり、根拠のないready・対象外に変えたりして合格させない。機械検査が意味上の抽出漏れ・正しい期待結果を保証するとは扱わない。
4. 合格した草稿から提示用 `output.json` を新規保存し、同じ内容であることを確認する。自力で3回修正しても解決しない、またはNode.jsが使えない場合は原因と未検査/不合格を明示し、完成品として渡さない。資料不足によるpendingと出力の不整合を混同しない。
5. 人向け表示を作り、JSONと保留状態・空白・値が一致するか読む。

```text
node "<skill>/scripts/render_output.ts" --input "<run>/output.json" --output "<run>/output.md"
```

検査の失敗を隠さず、草稿・検査結果・最終出力を同じ新規実行フォルダに残す。既存の結果を上書きしない。現場形式へ転記する場合も同じ根拠・保留・対応関係を維持する。
