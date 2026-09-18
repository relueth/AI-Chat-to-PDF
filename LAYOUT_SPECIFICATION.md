# カスタムレイアウト作成仕様書 (Custom Layout Specification)

本ドキュメントは、AI Chat to PDF / HTML エクステンションにおいて、ユーザー独自のレイアウト（外部CSSおよび外部HTMLテンプレート）を作成・インポートするための技術仕様書です。

---

## 1. 概要とサポート形式

外部レイアウトは以下の2つの方法でカスタマイズできます。

1. **カスタムCSS (.css)**: 既存のDOM構造を活かしたまま、色、フォント、余白、罫線、配置スタイルを柔軟に変更します。
2. **カスタムHTMLテンプレート (.html)**: メッセージカードやヘッダーの構造そのものを再構築します。

---

## 2. カスタムCSS作成仕様

エクスポート画面では、チャット全体のルートコンテナに `#chat-container` が設定され、メッセージごとに `.msg-card` が配置されます。

### 2.1 主要なHTML構造とCSSセレクタ一覧

```html
<div id="chat-container">
  <!-- 会話タイトル / メタ情報ヘッダー -->
  <header class="export-header">
    <h1 class="chat-title">タイトル</h1>
    <div class="chat-meta">
      <span class="meta-item">モデル: Claude 3.5 Sonnet</span>
      <span class="meta-item">日時: 2026/09/18</span>
    </div>
  </header>

  <!-- 各メッセージカード -->
  <article class="msg-card msg-user" data-role="user">
    <div class="msg-header">
      <div class="msg-avatar">👤</div>
      <div class="msg-sender">ユーザー</div>
      <time class="msg-time">10:30</time>
    </div>
    <div class="msg-body">
      <p>メッセージ本文...</p>
    </div>
  </article>

  <article class="msg-card msg-assistant" data-role="assistant">
    <div class="msg-header">
      <div class="msg-avatar">🤖</div>
      <div class="msg-sender">Assistant</div>
      <time class="msg-time">10:31</time>
    </div>
    <div class="msg-body">
      <p>回答本文...</p>
      <!-- 数式、コードブロック、テーブル等 -->
    </div>
  </article>
</div>
```

### 2.2 推奨CSS変数（テーマカラー定義）

カスタムCSS内で以下の変数を上書きすることで、全体の色合いを一括変更できます。

```css
:root {
  --bg-page: #f9fafb;             /* ページ全体の背景色 */
  --bg-card-user: #eff6ff;         /* ユーザー発言カード背景 */
  --bg-card-assistant: #ffffff;    /* AI発言カード背景 */
  --border-user: #bfdbfe;          /* ユーザーカード枠線 */
  --border-assistant: #e5e7eb;     /* AIカード枠線 */
  --text-primary: #111827;         /* 本文テキストカラー */
  --text-muted: #6b7280;           /* 日時や注釈テキスト */
  --font-family-base: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-family-code: "JetBrains Mono", Consolas, Menlo, monospace;
}
```

### 2.3 印刷・PDF出力時（@media print）の必須ルール

PDF変換時の改ページ破綻や枠線の途切れを防ぐため、以下のプロパティを保持することを推奨します。

```css
@media print {
  /* メッセージカードの途中で改ページされるのを防ぐ */
  .msg-card {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  /* コードブロックや数式の途切れ防止 */
  pre, .katex-display, table {
    break-inside: avoid-page;
  }
}
```

---

## 3. カスタムHTMLテンプレート作成仕様

メッセージブロックのHTMLを独自に構成したい場合、プレースホルダー（マクロ変数）を用いたHTMLテンプレートを作成します。

### 3.1 テンプレートプレースホルダー一覧

| プレースホルダー | 出力内容 | 例 |
| :--- | :--- | :--- |
| `{{role}}` | 発言者のロール（`user` または `assistant`） | `user` |
| `{{sender}}` | 発言者の表示名 | `ユーザー`, `Claude`, `ChatGPT` |
| `{{avatar}}` | アバターアイコン（絵文字またはSVG/画像） | `👤`, `🤖` |
| `{{time}}` | 発言日時（取得できている場合） | `2026/09/18 10:30` |
| `{{body}}` | メッセージ本文（HTML変換・数式処理済み） | `<p>回答内容...</p>` |
| `{{index}}` | メッセージの通し番号 (1, 2, 3...) | `1` |

### 3.2 HTMLテンプレートの記述例

```html
<!-- template.html -->
<div class="custom-card custom-{{role}}">
  <div class="custom-side-bar">
    <div class="custom-avatar">{{avatar}}</div>
    <span class="custom-index">#{{index}}</span>
  </div>
  <div class="custom-main-content">
    <div class="custom-header">
      <strong class="custom-sender">{{sender}}</strong>
      <span class="custom-time">{{time}}</span>
    </div>
    <div class="msg-body custom-body">
      {{body}}
    </div>
  </div>
</div>
```

> **注意**: メッセージ本文を格納する要素には、数式やシンタックスハイライト、マークダウン用スタイルの適用のため、必ずクラス名 `msg-body` を付与してください。

---

## 4. サンプルプリセット定義

本仕様に準拠した3つの代表的スタイル例です。

### ① 学術・レポート風 (Academic Theme)
```css
/* 吹き出しを廃止し、左ボーダーと明朝/セリフフォントで書籍・論文風に */
#chat-container {
  max-width: 800px;
  font-family: "Times New Roman", "Yu Mincho", "Hiragino Mincho ProN", serif;
  line-height: 1.8;
}
.msg-card {
  border: none !important;
  background: transparent !important;
  padding: 16px 0 !important;
  margin-bottom: 24px !important;
  border-bottom: 1px solid #e5e7eb !important;
}
.msg-user {
  border-left: 3px solid #3b82f6 !important;
  padding-left: 16px !important;
}
.msg-assistant {
  border-left: 3px solid #10b981 !important;
  padding-left: 16px !important;
}
```

### ② 公式仕様書・ドキュメント風 (Document Theme)
```css
/* Q&Aセクション形式 */
.msg-user .msg-header::before {
  content: "Q. ";
  font-weight: bold;
  color: #2563eb;
  font-size: 1.2em;
}
.msg-assistant .msg-header::before {
  content: "A. ";
  font-weight: bold;
  color: #059669;
  font-size: 1.2em;
}
```

### ③ コンパクト・メモ風 (Compact Theme)
```css
/* 余白を削り、用紙枚数を節約 */
.msg-card {
  padding: 6px 10px !important;
  margin-bottom: 6px !important;
  border-radius: 4px !important;
  font-size: 13px !important;
}
.msg-avatar { display: none; }
```

---

## 5. ファイルの取り込みと検証仕様

1. **インポート手順**:
   - ツールバーの「レイアウト」ボタンから「外部レイアウトの読み込み」を選択。
   - 作成した `.css` または `.html` ファイルをドラッグ＆ドロップ、またはコードを直接ペースト。
2. **安全性の保証**:
   - スクリプトタグ（`<script>`）やインラインイベントハンドラ（`onload`, `onclick` 等）は自動的にサニタイズされ、スタイルと構造のみが抽出されます。
   - インポートしたレイアウトはローカルストレージに保持され、HTMLファイル書き出し時にも埋め込まれます。
