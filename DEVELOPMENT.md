# 開発ガイド

最初に[README](README.md)、[Skill本体](skills/uat-scenario-design/SKILL.md)、[出力契約](skills/uat-scenario-design/references/output-contract.md)を読みます。実案件での調整は[更新手順](docs/adapting.md)、共有するファイルの選定は[共有手順](docs/sharing.md)に従います。

## 構成

|場所|用途|
|---|---|
|skills/uat-scenario-design/|単独利用できるSkillと検査・表示コードの正本|
|scripts/|プロジェクト用の入口、TypeScriptテスト、検証runner|
|evals/fixtures/|架空の入力資料|
|evals/samples/|出力契約の互換性・回帰検査用の架空JSON|
|docs/・templates/・inputs/|利用手順と記入前のひな形|
|private/（Git対象外）|実案件の資料・ルール・生成結果・評価記録|

## 変更と確認

現行版を固定して問題を再現し、必要な箇所だけ変更します。業務内容を変える修正は、構造検査だけでなく原資料と生成結果を照合します。共通の手順、チーム固有ルール、案件固有情報を分けます。公開テストには架空データを使います。

~~~powershell
npm ci
npm run typecheck
npm test
node scripts/validate_skill.ts skills/uat-scenario-design
~~~

Node.jsによるTypeScript直接実行は型検査を行いません。コード変更時はtypecheckも実行します。出力形式や利用手順が変わる場合は、対応する文書も更新します。単独利用の互換性はテスト内で確認します。

保存済み出力の検査と、新しいAI生成の評価は区別します。手順の詳細と内容レビュー項目は[検証手順](evals/検証手順.md)を参照してください。個別案件の進捗や評価結果はこの公開ガイドへ追記せず、非公開側に残します。
