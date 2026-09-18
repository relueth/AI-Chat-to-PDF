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

## 4. プリセットテンプレート一覧

エクステンションには以下の6種類の公式テンプレートが標準搭載されています。各テンプレートは `.document` または `#document` に付与されるクラス名で切り替わります。

| テンプレート名 | クラス名 | 特徴・デザインコンセプト | 主な用途 |
| :--- | :--- | :--- | :--- |
| **標準 (Modern Chat)** | `theme-default` | 丸みのある吹き出しカード・アイコン付きのモダンなチャットUI | 一般的な会話保存、普段使い |
| **技術・学術レポート** | `theme-academic` | 吹き出し背景や丸みを廃止し、左ボーダー、Serif/明朝系組版、1.8倍行送りで書籍・論文風の気品ある組版 | 論文、数式・コード解説、学術提出用 |
| **公式ドキュメント** | `theme-document` | 「Q.」「A.」の明瞭な構造化見出し、クリーンなグリッド、仕様書スタイルのセクション分離 | マニュアル、要件定義書、議事録 |
| **ノート** | `theme-note` | 余白やカードパディングを詰め、一覧性と印刷時の用紙枚数削減を最重視したコンパクト設計 | 印刷用紙の節約、要点メモ、復習用 |
| **ブログ** | `theme-blog` | Webマガジンやテックブログ風の洗練された1カラム組版、適度な行間、アイキャッチ感のあるアバターと見出し | 記事下書き、ノウハウ共有、公開用HTML |
| **対話形式の解説風** | `theme-dialogue` | 質問者（ユーザー）と解説役（AIチューター/メンター）の掛け合いを強調した吹き出しレイアウト。AI側に丁寧な解説ハイライト枠を適用 | 教材、Q&A形式の解説コンテンツ、FAQ |

---

## 5. プリセットテンプレートのスタイル定義例

### ① 技術・学術レポート (`.theme-academic`)
```css
.theme-academic {
  font-family: "Times New Roman", "Yu Mincho", "Hiragino Mincho ProN", serif;
  line-height: 1.8;
  color: #111827;
}
.theme-academic .msg {
  border: none !important;
  background: transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  padding: 18px 0 18px 20px !important;
  border-bottom: 1px solid #e5e7eb !important;
}
.theme-academic .msg-user {
  border-left: 3px solid #2563eb !important;
}
.theme-academic .msg-assistant {
  border-left: 3px solid #059669 !important;
}
```

### ② 公式ドキュメント (`.theme-document`)
```css
.theme-document .msg {
  border: 1px solid #d1d5db !important;
  border-radius: 6px !important;
  background: #ffffff !important;
  margin-bottom: 16px !important;
}
.theme-document .msg-user .msg-role::before {
  content: "Q. ";
  font-weight: 800;
  color: #2563eb;
}
.theme-document .msg-assistant .msg-role::before {
  content: "A. ";
  font-weight: 800;
  color: #059669;
}
```

### ③ ノート (`.theme-note`)
```css
.theme-note .msg {
  padding: 8px 12px !important;
  margin-bottom: 8px !important;
  border-radius: 4px !important;
  font-size: 13px !important;
  background: #fdfdfd !important;
  border: 1px solid #e5e7eb !important;
}
```

### ④ ブログ (`.theme-blog`)
```css
.theme-blog {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  line-height: 1.75;
}
.theme-blog .msg {
  border: none !important;
  background: transparent !important;
  padding: 24px 0 !important;
  border-bottom: 1px dashed #d1d5db !important;
}
.theme-blog .msg-role {
  font-size: 15px !important;
  font-weight: 700 !important;
}
```

### ⑤ 対話形式の解説風 (`.theme-dialogue`)
```css
/* 左側: AI（解説役） */
.theme-dialogue .msg-assistant {
  max-width: 92%;
  margin-right: auto;
  margin-left: 0;
  background: #ffffff !important;
  border: 2px solid #10b981 !important;
  border-radius: 16px 16px 16px 4px !important;
  box-shadow: 0 4px 12px rgba(16,185,129,0.08) !important;
}
.theme-dialogue .msg-assistant .msg-role::after {
  content: " [解説]";
  font-size: 0.85em;
  font-weight: 600;
  color: #059669;
}
/* 右側: あなた / ユーザー（質問役） */
.theme-dialogue .msg-user {
  max-width: 84%;
  margin-left: auto;
  margin-right: 0;
  background: #eff6ff !important;
  border: 1.5px solid #bfdbfe !important;
  border-radius: 16px 16px 4px 16px !important;
}
.theme-dialogue .msg-user .msg-role::after {
  content: " [質問]";
  font-size: 0.85em;
  font-weight: 500;
  color: #2563eb;
}
```

---

## 6. 外部レイアウトの取り込みと検証仕様

1. **インポート手順**:
   - ツールバーの「レイアウト」から「外部レイアウトの読み込み」を選択。
   - 作成した `.css` または `.html` ファイルをファイル選択（またはコード直接貼り付け）。
2. **安全性の保証**:
   - スクリプトタグ（`<script>`）やインラインイベントハンドラ（`onload`, `onclick` 等）は自動的に除去（サニタイズ）され、スタイルと構造のみが適用されます。
   - 読み込まれた外部CSSは `<style id="custom-layout-style">` に即時反映され、HTMLエクスポート時にも自動で埋め込まれます。
