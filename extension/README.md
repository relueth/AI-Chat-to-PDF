# AI Chat to PDF (Kimi / Gemini / Claude / Genspark / ChatGPT / Grok)

AIの会話を **数式のレイアウトを崩さずに** **PDF / HTML / テキスト** のいずれかに変換するChrome拡張機能（Manifest V3）です。

## 変換形式（ポップアップで選択）

| 形式 | 内容 | 数式の扱い |
|------|------|-----------|
| **PDF** | 専用ページで印刷ダイアログを開き「PDFに保存」 | KaTeX描画済みレイアウトを保持 |
| **HTML** | KaTeXのCSS/フォント参照とスタイルを含む**自立した単一HTML**をダウンロード | KaTeX描画済みレイアウトを保持（ブラウザで閲覧・印刷可能） |
| **テキスト** | Markdown風テキスト（.txt, BOM付きUTF-8）をダウンロード | KaTeX内のTeX注釈から `$...$` / `$$...$$` 記法に復元 |

## 対応サービス（優先順位順）

1. **Kimi** (`kimi.ai`, `kimi.com`, `kimi.moonshot.cn`)
2. **Gemini** (`gemini.google.com`)
3. **Claude** (`claude.ai`)
4. **Genspark** (`genspark.ai`)
5. **ChatGPT** (`chatgpt.com`, `chat.openai.com`)
6. **Grok** (`grok.com`, `x.com/i/grok`)

## 特徴

- **数式の形崩れ防止**
  - 各サイトでレンダリング済みのKaTeX HTMLをそのままクローンするため、TeXソース再描画による崩れがありません。
  - エクスポートページでKaTeX公式CSS/フォント（CDN）を読み込み、`document.fonts.ready` でフォント適用完了を待ってから印刷します。
  - 印刷CSSで `.katex-display`・数式・コードブロック・表に `break-inside: avoid-page` を適用し、改ページでの切断も防ぎます。
- **会話全体の自動抽出**: 仮想リスト（画面外メッセージがDOMから消える実装）に対応するため、スクロールコンテナを自動で遡りながら全会話を逐次収集・重複排除します。
- **クリーンな出力**: コピーボタン・アクションバー・フィードバックUI等のノイズを除去し、読みやすい白背景レイアウトでPDF化します。
- **安全設計**: 抽出HTMLから `script` / `iframe` / イベントハンドラ / `javascript:` URL を二重にサニタイズ。取得データは `chrome.storage.session`（メモリ、タブ閉鎖で消滅）のみを使用し、外部送信は一切ありません。

## 使い方

### インストール（開発者モード）

1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」→ この `extension/` フォルダを選択

### 変換の手順

1. Kimi / Gemini / Claude / Genspark / ChatGPT / Grok の会話ページを開く
2. ツールバーの拡張機能アイコンをクリック
3. **変換形式（PDF / HTML / テキスト）** をラジオボタンで選択
4. ボタンを押すと全会話を自動抽出（スクロール遡り）し、エクスポートページが新しいタブで開きます
   - **PDF選択時**: 印刷ダイアログが自動表示 → 送信先「PDFに保存」（余白「デフォルト」推奨）
   - **HTML選択時**: `.html` ファイルが自動ダウンロード
   - **テキスト選択時**: `.txt` ファイルが自動ダウンロード
5. エクスポートページのツールバーからは、いつでも別形式（PDF印刷 / HTML / テキスト）で再出力できます

## ファイル構成

```
extension/
├── manifest.json          # MV3マニフェスト
├── _locales/ja/messages.json
├── content/content.js     # 会話DOM抽出（サイト別セレクタ・スクロール収集）
├── popup/                 # 拡張機能ポップアップ（検出・抽出起動）
│   ├── popup.html / popup.css / popup.js
├── export/                # PDF用レンダリングページ
│   ├── export.html / export.css / export.js
└── icons/                 # アイコン (16/32/48/128)
```

## 技術メモ

- サイト判定はホスト名ベース。メッセージセレクタは各サイトの実装変更に備え複数フォールバックを持たせています。
- **ChatGPT** は `data-message-author-role="user" / "assistant"` 属性による安定したrole判定を利用します。うまく抽出できない場合は `content/content.js` の `SITE_CONFIGS` 内 `chatgpt` のセレクタを更新してください。
- **Genspark** はDOM構造の変更が多いため、複数候補セレクタに加えて、role判定が一致しない場合の**汎用フォールバック抽出**（markdown本文ブロックをDOM順に拾い「先頭=ユーザー→以降交互」と推定）を備えています。うまく抽出できない場合は `content/content.js` の `SITE_CONFIGS` 内 `genspark` のセレクタを実際のDOMに合わせて更新してください。
- 各サイトのDOM構造変更で抽出できなくなった場合は `content/content.js` の `SITE_CONFIGS` のセレクタを更新してください。
- PDF生成はブラウザ標準の印刷機能を利用（外部PDFライブラリ不使用）のため、数式フォント・日本語の品質が高く、ファイルサイズも小さくなります。
- テキスト変換ではDOMを再帰走査し、見出し・リスト・表・コードブロック・引用・リンクをMarkdown記法に、KaTeX要素は `annotation[encoding="application/x-tex"]` 内のTeXソースから `$...$`（インライン）/ `$$...$$`（ディスプレイ）に変換します。

## 未実装・今後の拡張案

- ChatGPT / Perplexity 等の追加対応（`SITE_CONFIGS` に設定を追加するだけで拡張可能）
- 抽出範囲の選択（最新N件のみ等）
- ダークテーマ出力オプション
- Markdown (.md) 形式での直接保存（現在は .txt）
- Chrome Web Store への公開
