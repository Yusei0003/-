# AGENTS.md（交通費取りまとめアプリ）

このリポジトリでAIエージェント（Codex等）が作業するときの手引きです。機能の詳しい説明は `README.md` を参照してください。

## 概要

- KESEN LARUS BASKETBALL CLUB のスタッフ5名への交通費（規程第3条・第4条）を毎月取りまとめるWebアプリ
- 利用者は日本語話者。画面表示・印刷物・コミットメッセージ・README はすべて日本語で書く
- 審判・コミッショナーの謝礼金は別アプリ（`larus-sharei` リポジトリ）で管理している。**こちらへの依頼をあちらに、あちらへの依頼をこちらに勝手に適用しない**

## 構成

ビルド工程のない素のHTML/CSS/JavaScriptで、GitHub Pages（`main` ブランチ）から配信している。

| ファイル | 役割 |
|---|---|
| `index.html` | 画面（入力・一覧・月次集計・ダッシュボードの4タブ）と印刷用の空コンテナ |
| `app.js` | アプリ本体。支給ルール（`RULES` / `RECEIPT_ROWS`）、集計、CSV取込、Excel出力、受領書・封筒の印刷 |
| `style.css` | 画面と印刷のスタイル |
| `xlsx-writer.js` | 依存ライブラリなしの簡易 .xlsx 書き出し |
| `firebase-entry.js` | Firebase初期化と `window.FirebaseData` API |
| `firebase-bundle.js` | `firebase-entry.js` をesbuildでまとめた生成物。**直接編集しない**（再ビルド手順は README） |
| `logo.png` / `icon.png` / `apple-touch-icon.png` | クラブロゴとアイコン |
| `.github/workflows/version-assets.yml` | push時に `index.html` の読み込みURLへ `?v=日時` を自動付与（キャッシュ対策）。この自動コミットがあるので、push前に必ず `git pull` する |

## データ

- Firebase（Firestore + Authentication）。コレクションは `records`（活動記録）と `contacts/main`（受領書用の住所・電話）
- 同じFirebaseプロジェクトを謝礼アプリ（`sharei_records` / `sharei_meta`）も使っている。コレクション名・ログイン方式・`firebaseConfig` は両アプリに影響するので、勝手に変えない
- 合言葉（パスワード）はリポジトリに書かない

## 動作確認

- `python3 -m http.server` で配信して `index.html` を開く。実データを見るには合言葉でのログインが必要
- ログインなしで画面や印刷を確かめるときは、`firebase-bundle.js` の代わりに `window.FirebaseData` を同じ形で返すモックを読み込ませ、テスト用の記録を流し込む（Playwright の `page.route` で差し替えると楽）
- 印刷の確認は、印刷ボタンを押したあとに Playwright の `page.pdf({ preferCSSPageSize: true })` でPDF化し、**ページ数と用紙サイズ**まで確認する（見た目が正しくても白紙ページが混ざることがある）

## 印刷まわりの注意（過去に実際に起きた不具合）

- 用紙サイズは `printWithPageSize('297mm 210mm')` のように、印刷直前に `@page` を差し込み、印刷後に取り除く。受領書はA4横、封筒は長形3号（120×235mm）。CSSに `@page` を固定で書くと、もう一方の印刷物と競合する
- 受領書と封筒は印刷用の領域を別々に持つ。描画関数の最初で**もう一方の領域を空にする**（CSSだけで隠すと、前に印刷した内容が重なって出る）
- `@media print` ではアプリ本体（`.app-header, .tabs, main, #toast, #chart-tooltip, #login-overlay`）を `display: none` にしている。`visibility: hidden` だけにすると高さが残り、余分な白紙ページが出る
- 長い住所を1行に収める自動縮小（`fitReceiptFieldText`）は、通常は非表示の印刷領域を一時的に表示してから幅を測る。非表示のままだと幅が0になり、縮小されない
- 受領書は1ページが用紙ぴったりの寸法になっているので、要素を足すときは高さが用紙を超えないか、PDFのページ数で確かめる

## 進め方の約束

- 印刷物や画面の**見た目を変える依頼**は、実装後にプレビュー画像（PDFを画像化したもの）を見せ、利用者から「実装」と返事をもらってから `main` にpushする
- `main` へのpushはそのまま本番（GitHub Pages）に反映される
- 依頼された範囲だけを変更する。金額のルールは規程（`RULES` / `RECEIPT_ROWS`）に合わせ、勝手に変えない
- 機能を変えたら `README.md` の該当箇所も更新する
