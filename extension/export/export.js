/**
 * AI Chat to PDF - Export Page Script
 * chrome.storage.session に保存された会話データをDOMに流し込み、
 * 選択された形式 (pdf / html / text) に変換する。
 *
 * - pdf : KaTeXフォント読み込み完了後に印刷ダイアログを開く
 * - html: KaTeX CSS参照とexport.cssをインライン化した自立HTMLをダウンロード
 * - text: KaTeXのTeX注釈を $...$ / $$...$$ に復元したMarkdown風テキストをダウンロード
 */
(() => {
  'use strict';

  const loadingEl = document.getElementById('loading');
  const messagesEl = document.getElementById('messages');
  const docTitleEl = document.getElementById('doc-title');
  const docMetaEl = document.getElementById('doc-meta');
  const tbSiteEl = document.getElementById('tb-site');
  const tbTitleEl = document.getElementById('tb-title');
  const tbCountEl = document.getElementById('tb-count');
  const tbHintEl = document.getElementById('toolbar-hint');
  const selectMathEngine = document.getElementById('select-math-engine');
  const btnPrint = document.getElementById('btn-print');
  const btnDlHtml = document.getElementById('btn-dl-html');
  const btnDlText = document.getElementById('btn-dl-text');
  const btnClose = document.getElementById('btn-close');

  // 数式エンジンの初期設定 (標準: KaTeX)
  let currentMathEngine = 'katex';
  try {
    const savedEngine = localStorage.getItem('preferred_math_engine');
    if (savedEngine === 'mathjax' || savedEngine === 'katex') {
      currentMathEngine = savedEngine;
    }
  } catch (_) {}

  // 会話削除・選択UI要素
  const editBarEl = document.getElementById('edit-bar');
  const chkSelectAll = document.getElementById('chk-select-all');
  const btnDeleteSelected = document.getElementById('btn-delete-selected');
  const selectedCountEl = document.getElementById('selected-count');
  const btnUndo = document.getElementById('btn-undo');
  const deletedCountEl = document.getElementById('deleted-count');
  const activeBadgeEl = document.getElementById('active-badge');
  const emptyNoticeEl = document.getElementById('empty-notice');
  const btnRestoreAll = document.getElementById('btn-restore-all');

  const ROLE_LABEL = { user: 'あなた', assistant: 'AI' };

  const FORMAT_HINTS = {
    pdf: '不要な会話を選択・削除して整理した後、「PDFとして保存」を押してください。印刷ダイアログで「送信先 → PDFに保存」を選びます。',
    html: '不要な会話を選択・削除して整理した後、「HTMLを保存」を押してください。削除後の内容で単一HTMLファイルをダウンロードします。',
    text: '不要な会話を選択・削除して整理した後、「テキストを保存」を押してください。削除後の内容でMarkdown風テキストを出力します。'
  };

  let currentPayload = null;
  let currentFormat = 'pdf';

  // 削除・選択状態の管理
  const deletedMessageIds = new Set();
  const selectedMessageIds = new Set();
  const undoHistory = []; // { type: 'single' | 'batch', ids: string[] }

  // ---------------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------------
  function escapeText(s) {
    return String(s == null ? '' : s);
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return '';
    }
  }

  function formatDateForFilename(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    } catch (_) {
      return '';
    }
  }

  /** ファイル名に使えない文字を除去 */
  function sanitizeFilename(name) {
    return String(name || 'AI会話')
      .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'AI会話';
  }

  function downloadBlob(content, filename, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // HTMLサニタイズ
  // ---------------------------------------------------------------
  const MATH_CONTAINER = '.katex, .katex-display, mjx-container, [class*="mjx-"], .MathJax, math, [class*="math"]';

  /**
   * 数式要素から生TeXコードを安全に退避・保持する
   * 累乗(^2)や分数(\frac)の平坦化を防止するため、全数式要素に data-tex 属性を付与
   */
  function preserveMathDataInContainer(root) {
    if (!root) return;
    // 1. KaTeX 要素の annotation (生TeX) を退避
    root.querySelectorAll('.katex, .katex-display').forEach((k) => {
      if (k.getAttribute('data-tex')) return;
      const ann = k.querySelector('annotation[encoding="application/x-tex"], annotation');
      if (ann && ann.textContent.trim()) {
        const raw = ann.textContent.trim();
        k.setAttribute('data-tex', raw);
        // 子の .katex や 親の .katex-display にも両方付与
        const inner = k.querySelector('.katex');
        if (inner && !inner.getAttribute('data-tex')) inner.setAttribute('data-tex', raw);
        const parentDisplay = k.closest('.katex-display');
        if (parentDisplay && !parentDisplay.getAttribute('data-tex')) parentDisplay.setAttribute('data-tex', raw);
      }
    });

    // 2. MathJax (mjx-container)
    root.querySelectorAll('mjx-container').forEach((mjx) => {
      if (mjx.getAttribute('data-tex')) return;
      const alt = mjx.getAttribute('alttext') || mjx.getAttribute('aria-label');
      if (alt && alt.trim()) {
        mjx.setAttribute('data-tex', alt.trim());
      } else {
        const ann = mjx.querySelector('annotation');
        if (ann && ann.textContent.trim()) {
          mjx.setAttribute('data-tex', ann.textContent.trim());
        }
      }
    });

    // 3. その他 data-math, data-latex
    root.querySelectorAll('[data-math], [data-latex], [data-tex-source], [class*="math-tex"]').forEach((el) => {
      const tex = el.getAttribute('data-math') || el.getAttribute('data-latex') || el.getAttribute('data-tex-source');
      if (tex && !el.getAttribute('data-tex')) {
        el.setAttribute('data-tex', tex.trim());
      }
    });
  }

  function sanitizeHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;

    // スクリプトやフォーム等の不要要素を除去 (数式コンテナは保持)
    tpl.content.querySelectorAll(
      'script, iframe, object, embed, form, link, meta, style, [class*="query-header"]'
    ).forEach((n) => n.remove());

    // 数式要素の生TeXコード (累乗^2、添字、分数等) を最優先で data-tex 属性に退避
    preserveMathDataInContainer(tpl.content);
    tpl.content.querySelectorAll('annotation').forEach((n) => n.remove());

    tpl.content.querySelectorAll(
      '.visually-hidden, [class*="visually-hidden"], .cdk-visually-hidden, [class*="cdk-visually-hidden"], .sr-only, [class*="sr-only"]'
    ).forEach((n) => {
      if (!n.closest(MATH_CONTAINER)) {
        n.remove();
      }
    });

    // 重複した「あなたのプロンプト」や「Gemini の回答」等のヘッダーを除去 (画像を含むものは保護)
    tpl.content.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"], [class*="label"]').forEach((el) => {
      if (!el.querySelector('img') && /^(あなたのプロンプト|Your prompt|Gemini の回答|Gemini's response|Grok の回答|Grok's response)/i.test(el.textContent.trim())) {
        el.remove();
      }
    });

    // 空の blockquote や 空のコンテナを除去 (添付ファイル周辺や単独の縦線を除去)
    tpl.content.querySelectorAll('blockquote').forEach((bq) => {
      if (!bq.textContent.trim() && !bq.querySelector('img')) {
        bq.remove();
      }
    });

    // 添付ファイルカード等の空の区切り縦線要素を除去
    tpl.content.querySelectorAll('div, span, hr').forEach((el) => {
      if (el.closest(MATH_CONTAINER)) return;
      if (el.children.length === 0 && !el.textContent.trim() && !el.querySelector('img')) {
        const cls = el.className || '';
        if (typeof cls === 'string' && (
          cls.includes('w-px') ||
          cls.includes('border-l') ||
          cls.includes('border-r') ||
          cls.includes('divider') ||
          cls.includes('separator')
        )) {
          el.remove();
        }
      }
    });

    const all = tpl.content.querySelectorAll('*');
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
          el.removeAttribute(attr.name);
        }
      }
      if (el.tagName === 'IMG') {
        el.setAttribute('referrerpolicy', 'no-referrer');
        el.setAttribute('loading', 'eager');
      }
    }
    return tpl.innerHTML;
  }

  // ---------------------------------------------------------------
  // 数式レンダリング (KaTeX: 標準・高速 / MathJax: 高精度 切替対応)
  // ---------------------------------------------------------------

  /** ユーザー発言内の「あなたのプロンプト」ラベルを除去 */
  function cleanUserPromptLabel(body) {
    if (!body) return;
    const potentialHeaders = body.querySelectorAll('p, div, span, h1, h2, h3');
    for (const ph of potentialHeaders) {
      if (ph.querySelector('img')) continue;
      const trimmed = ph.textContent.trim();
      if (/^(あなたのプロンプト|Your prompt)\s*$/i.test(trimmed)) {
        ph.remove();
      } else if (/^(あなたのプロンプト|Your prompt)\s*[:：]?\s*/i.test(trimmed)) {
        if (body.children.length > 1) {
          ph.remove();
        } else {
          ph.textContent = trimmed.replace(/^(あなたのプロンプト|Your prompt)\s*[:：]?\s*/i, '');
        }
      }
    }
  }

  /**
   * TeX文字列を正規化し、テキストモードのローマン体化や関数名補正を行う
   * 1. sin, cos, tan, log 等の標準関数を \sin, \cos 等に補正 (テキストモードでのローマン体・立体化)
   *    累乗(^2)や添字(_n)がある場合は結合を壊さず維持
   * 2. (Cは積分定数) 等の日本語注釈を \text{(Cは積分定数)} に補正 (英字Cも日本語もローマン体化)
   */
  function normalizeTex(tex) {
    if (!tex) return '';
    let res = tex;

    const funcs = 'sinh|cosh|tanh|coth|sin|cos|tan|cot|sec|csc|log|ln|lg|lim|exp|max|min|det|deg|dim|gcd|hom|inf|ker|Pr|sup';

    // 1. 直前にバックスラッシュのない標準数学関数 (sin, cos, tan, log 等) を \sin, \cos 等に補正
    // 直後に ^ (累乗指数) や _ (添字) がある場合はスペースを挟まず \sin^2 x のように結合を保持
    const fnSupRegex = new RegExp('(^|[^a-zA-Z\\\\])(' + funcs + ')(?=[\\^_])', 'g');
    res = res.replace(fnSupRegex, (match, prefix, fn) => prefix + '\\' + fn);

    // その他の通常引数の場合 (例: sin2x -> \sin 2x, 2sinxcosx -> 2\sin x \cos x)
    const fnRegex = new RegExp('(^|[^a-zA-Z\\\\])(' + funcs + ')(?=[0-9a-zA-Z\\s+=_\\-)]|$)', 'g');
    res = res.replace(fnRegex, (match, prefix, fn) => prefix + '\\' + fn + ' ');

    // 連続した変数と関数 (例: xcosx -> x \cos x)
    const fnTightRegex = new RegExp('(?<=[a-z])(' + funcs + ')(?=[0-9a-zA-Z\\s+=_\\-)]|$)', 'g');
    res = res.replace(fnTightRegex, (match, fn) => ' \\' + fn + ' ');

    // 2. 数式中の注釈 (Cは積分定数) などの日本語括弧書きを \text{(...)} に補正
    // 例: (C\text{は積分定数}) や (Cは積分定数) を \text{(Cは積分定数)} に統一
    // これにより、英字 C も日本語もすべてローマン体（立体・直立）として描画される
    res = res.replace(/(\([^)]*[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+[^)]*\))/g, (m) => {
      const plain = m.replace(/\\(?:text|mathrm|textrm|textnormal)\{([^}]*)\}/g, '$1');
      return ' \\text{' + plain + '}';
    });

    // 3. 数式内で \text{} に入っていない孤立した日本語文字列を \text{} で包む
    res = res.replace(/([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+)/g, (match, cjk, offset, full) => {
      const before = full.slice(0, offset);
      const lastOpen = before.lastIndexOf('\\text{');
      if (lastOpen !== -1) {
        const sub = before.slice(lastOpen);
        const openCount = (sub.match(/\{/g) || []).length;
        const closeCount = (sub.match(/\}/g) || []).length;
        if (openCount > closeCount) return cjk;
      }
      return '\\text{' + cjk + '}';
    });

    return res.replace(/  +/g, ' ').trim();
  }

  /** 要素 (KaTeX, MathJax, プレースホルダー等) から生のTeX文字列を抽出 */
  function getTexFromMathElement(el) {
    if (!el) return '';
    // 1. data-tex 属性 (自身、親、子)
    if (el.getAttribute('data-tex')) return el.getAttribute('data-tex');
    const withDataTex = el.querySelector('[data-tex]');
    if (withDataTex && withDataTex.getAttribute('data-tex')) {
      return withDataTex.getAttribute('data-tex');
    }
    const parentWithDataTex = el.closest('[data-tex]');
    if (parentWithDataTex && parentWithDataTex.getAttribute('data-tex')) {
      return parentWithDataTex.getAttribute('data-tex');
    }

    // 2. annotation タグ (まだDOMに残っている場合)
    const ann = el.querySelector('annotation[encoding="application/x-tex"], annotation');
    if (ann && ann.textContent.trim()) return ann.textContent.trim();

    // 3. alttext, aria-label, data-original-tex, data-latex, data-math
    const alt = el.getAttribute('alttext') || el.getAttribute('data-original-tex') ||
                el.getAttribute('data-latex') || el.getAttribute('data-math');
    if (alt && alt.trim()) return alt.trim();

    // 4. 重大: すでにレンダリングされた KaTeX 要素 (.katex, .katex-display, .katex-html) や
    // MathJax (mjx-container) である場合、生TeX属性が無い限り、絶対に textContent を TeX コードとして扱ってはならない！
    // (textContent では上付き添字 ^2 や分数 \frac が抜け落ちて sin2x や 12 に平坦化されるため)
    if (el.classList.contains('katex') || el.classList.contains('katex-display') ||
        el.querySelector('.katex-html') || el.closest('.katex') || el.closest('.katex-display') ||
        el.tagName === 'MJX-CONTAINER' || el.querySelector('mjx-container')) {
      return ''; // 安全のため空文字を返し、破壊的な上書き再描画を完全に防止
    }

    // 5. 通常の未レンダリングテキスト要素 ($...$, $$...$$, \[...\], \(...\)) の場合のみ textContent から抽出
    const txt = el.textContent.trim();
    return txt.replace(/^\$\$([\s\S]*)\$\$$/, '$1')
              .replace(/^\$([\s\S]*)\$$/, '$1')
              .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
              .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
              .trim();
  }

  /** KaTeX によるレンダリング (標準) */
  function renderWithKaTeX(container) {
    if (!container) return;

    // 1. 既存の MathJax (mjx-container) や math-holder を KaTeX で再レンダリング
    const mjxContainers = container.querySelectorAll('mjx-container, .math-holder');
    for (const mjx of mjxContainers) {
      const isDisplay = mjx.getAttribute('display') === 'true' ||
                        mjx.getAttribute('data-display') === 'true' ||
                        mjx.classList.contains('math-display') ||
                        mjx.tagName === 'DIV';
      const rawTex = getTexFromMathElement(mjx);
      if (rawTex && typeof window.katex === 'object' && typeof window.katex.render === 'function') {
        const normTex = normalizeTex(rawTex);
        try {
          const target = document.createElement(isDisplay ? 'div' : 'span');
          target.className = isDisplay ? 'katex-display' : 'katex-inline';
          target.setAttribute('data-tex', normTex);
          target.setAttribute('data-display', isDisplay ? 'true' : 'false');
          window.katex.render(normTex, target, {
            displayMode: isDisplay,
            output: 'html',
            throwOnError: false
          });
          mjx.replaceWith(target);
        } catch (_) {}
      }
    }

    // 2. 既存の KaTeX 要素 (.katex-display, .katex) のテキストモード補正 (ローマン体化)
    // 注意: rawTex (生TeXコード) が確実に取得できた場合のみ正規化して再描画する。
    // rawTex が存在しない場合は、元サイトが正しくレンダリングしたDOMなので、上書き破壊せずそのまま保持する！
    const existingKatex = container.querySelectorAll('.katex-display, .katex');
    for (const ek of existingKatex) {
      if (ek.closest('.katex-display') && !ek.classList.contains('katex-display')) continue;
      const isDisplay = ek.classList.contains('katex-display');
      const rawTex = getTexFromMathElement(ek);
      if (rawTex) {
        const normTex = normalizeTex(rawTex);
        // TeXコードが補正された場合は再描画してローマン体を適用
        if (normTex !== rawTex && typeof window.katex === 'object' && typeof window.katex.render === 'function') {
          try {
            const target = document.createElement(isDisplay ? 'div' : 'span');
            target.className = isDisplay ? 'katex-display' : 'katex-inline';
            target.setAttribute('data-tex', normTex);
            target.setAttribute('data-display', isDisplay ? 'true' : 'false');
            window.katex.render(normTex, target, {
              displayMode: isDisplay,
              output: 'html',
              throwOnError: false
            });
            ek.replaceWith(target);
          } catch (_) {}
        }
      }
    }

    // 3. auto-render: テキストノード内の $...$, $$...$$, \(...\), \[...\] を数式に変換
    if (typeof window.renderMathInElement === 'function') {
      try {
        window.renderMathInElement(container, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\begin{equation}', right: '\\end{equation}', display: true },
            { left: '\\begin{align}', right: '\\end{align}', display: true },
            { left: '\\begin{alignat}', right: '\\end{alignat}', display: true },
            { left: '\\begin{gather}', right: '\\end{gather}', display: true },
            { left: '\\begin{CD}', right: '\\end{CD}', display: true },
            { left: '\\begin{matrix}', right: '\\end{matrix}', display: true },
            { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', display: true },
            { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', display: true }
          ],
          ignoredClasses: [
            'katex', 'katex-display', 'katex-mathml', 'katex-html',
            'MathJax', 'mjx-container', 'sr-only', 'visually-hidden'
          ],
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'annotation', 'math', 'svg'],
          output: 'html',
          throwOnError: false
        });
      } catch (e) {
        console.warn('KaTeX auto-render warning:', e);
      }
    }

    // 4. 明示的タグ (.math, [data-tex] 等) のレンダリング
    if (typeof window.katex === 'object' && typeof window.katex.render === 'function') {
      const candidates = container.querySelectorAll(
        '.math, [class*="math-inline"], [class*="math-display"], [class*="language-math"], [class*="language-latex"], [data-tex]'
      );
      for (const el of candidates) {
        if (el.querySelector('.katex') || el.classList.contains('katex') || el.classList.contains('katex-display')) continue;
        const rawTex = getTexFromMathElement(el);
        if (!rawTex) continue;
        const isDisplay = el.classList.contains('math-display') ||
                          el.getAttribute('data-display') === 'true' ||
                          el.getAttribute('display') === 'true' ||
                          el.tagName === 'DIV';
        const normTex = normalizeTex(rawTex);
        try {
          const target = document.createElement(isDisplay ? 'div' : 'span');
          target.className = isDisplay ? 'katex-display' : 'katex-inline';
          target.setAttribute('data-tex', normTex);
          target.setAttribute('data-display', isDisplay ? 'true' : 'false');
          window.katex.render(normTex, target, {
            displayMode: isDisplay,
            output: 'html',
            throwOnError: false
          });
          el.replaceWith(target);
        } catch (_) { /* noop */ }
      }
    }
  }

  /** MathJax によるレンダリング (ディスプレイ数式・インライン数式を完全にMathJaxへ変換) */
  async function renderWithMathJax(container) {
    if (!container) return;

    // 1. 既存の KaTeX 要素 (.katex-display, .katex) を MathJax が認識可能な要素に変換
    // ディスプレイ数式: .katex-display
    const katexDisplays = container.querySelectorAll('.katex-display');
    for (const kd of katexDisplays) {
      const rawTex = getTexFromMathElement(kd);
      if (rawTex) {
        const normTex = normalizeTex(rawTex);
        const div = document.createElement('div');
        div.className = 'math-holder math-display';
        div.setAttribute('data-tex', normTex);
        div.setAttribute('data-display', 'true');
        div.textContent = `\\[${normTex}\\]`;
        kd.replaceWith(div);
      }
    }

    // インライン数式: .katex
    const katexInlines = container.querySelectorAll('.katex');
    for (const ki of katexInlines) {
      if (ki.closest('.katex-display')) continue;
      const rawTex = getTexFromMathElement(ki);
      if (rawTex) {
        const normTex = normalizeTex(rawTex);
        const span = document.createElement('span');
        span.className = 'math-holder math-inline';
        span.setAttribute('data-tex', normTex);
        span.setAttribute('data-display', 'false');
        span.textContent = `\\(${normTex}\\)`;
        ki.replaceWith(span);
      }
    }

    // 2. 未区切りTeX要素 (.math, [data-tex] 等) を MathJax デリミタ形式に変換
    const candidates = container.querySelectorAll(
      '.math, [class*="math-inline"], [class*="math-display"], [class*="language-math"], [class*="language-latex"], [data-tex]'
    );
    for (const el of candidates) {
      if (el.querySelector('mjx-container') || el.classList.contains('MathJax') || el.classList.contains('math-holder')) continue;
      const rawTex = getTexFromMathElement(el);
      if (!rawTex) continue;
      const isDisplay = el.classList.contains('math-display') ||
                        el.getAttribute('data-display') === 'true' ||
                        el.getAttribute('display') === 'true' ||
                        el.tagName === 'DIV';
      const normTex = normalizeTex(rawTex);
      el.setAttribute('data-tex', normTex);
      el.setAttribute('data-display', isDisplay ? 'true' : 'false');
      el.textContent = isDisplay ? `\\[${normTex}\\]` : `\\(${normTex}\\)`;
    }

    // 3. MathJax.typesetPromise による描画実行
    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      try {
        if (typeof window.MathJax.typesetClear === 'function') {
          window.MathJax.typesetClear([container]);
        }
        await window.MathJax.typesetPromise([container]);
      } catch (err) {
        console.warn('MathJax typesetPromise warning:', err);
      }
    } else {
      // スクリプト未完了時の遅延待機
      let count = 0;
      const t = setInterval(async () => {
        count++;
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
          clearInterval(t);
          try {
            await window.MathJax.typesetPromise([container]);
          } catch (_) {}
        } else if (count > 25) {
          clearInterval(t);
        }
      }, 120);
    }
  }

  /** 現在選択されているエンジンで数式をレンダリング */
  async function renderMath(container) {
    if (!container) return;
    if (currentMathEngine === 'mathjax') {
      await renderWithMathJax(container);
    } else {
      renderWithKaTeX(container);
    }
  }

  /** 数式エンジンの切替 (KaTeX ↔ MathJax) */
  async function switchMathEngine(newEngine) {
    if (newEngine !== 'katex' && newEngine !== 'mathjax') return;
    currentMathEngine = newEngine;
    try {
      localStorage.setItem('preferred_math_engine', newEngine);
    } catch (_) {}

    // 各メッセージの本文をサニタイズ済みHTMLから再構成
    const msgWraps = messagesEl.querySelectorAll('.msg');
    for (const wrap of msgWraps) {
      const msgId = wrap.getAttribute('data-msg-id');
      const msgData = currentPayload && currentPayload.messages
        ? currentPayload.messages.find((m) => m.id === msgId)
        : null;
      if (!msgData) continue;

      const body = wrap.querySelector('.msg-body');
      if (body) {
        body.innerHTML = sanitizeHtml(msgData.html || '');
        if (msgData.role === 'user') {
          cleanUserPromptLabel(body);
        }
      }
    }

    // 選択された新しいエンジンで数式を一括レンダリング
    await renderMath(messagesEl);
    updateControlBarState();
  }

  // ---------------------------------------------------------------
  // 会話データの選択・削除・復元ロジック
  // ---------------------------------------------------------------
  function getActiveMessages() {
    if (!currentPayload || !currentPayload.messages) return [];
    return currentPayload.messages.filter((m) => !deletedMessageIds.has(m.id));
  }

  function updateDocMeta(activeCount, deletedCount) {
    if (!currentPayload) return;
    const { site, siteName, exportedAt, url } = currentPayload;
    docMetaEl.innerHTML = '';
    docMetaEl.appendChild(document.createTextNode(`サービス: ${siteName || site || '-'}`));
    if (exportedAt) {
      docMetaEl.appendChild(document.createTextNode('　|　エクスポート: ' + formatDate(exportedAt)));
    }
    if (deletedCount > 0) {
      docMetaEl.appendChild(document.createTextNode(`　|　出力: ${activeCount}件 (${deletedCount}件除外)`));
    } else {
      docMetaEl.appendChild(document.createTextNode(`　|　全${activeCount}件`));
    }
    if (url) {
      docMetaEl.appendChild(document.createElement('br'));
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      a.target = '_blank';
      a.rel = 'noopener';
      docMetaEl.appendChild(a);
    }
  }

  function updateControlBarState() {
    const active = getActiveMessages();
    const totalCount = currentPayload ? currentPayload.messages.length : 0;
    const activeCount = active.length;
    const deletedCount = deletedMessageIds.size;
    const selectedCount = selectedMessageIds.size;

    // ツールバーとバッジの件数更新
    if (deletedCount > 0) {
      tbCountEl.textContent = `${activeCount} / ${totalCount} メッセージ (${deletedCount}件削除中)`;
      activeBadgeEl.textContent = `${activeCount} / ${totalCount} 件`;
    } else {
      tbCountEl.textContent = `${activeCount} メッセージ`;
      activeBadgeEl.textContent = `全 ${activeCount} 件`;
    }

    updateDocMeta(activeCount, deletedCount);

    // 選択削除ボタンの状態
    selectedCountEl.textContent = String(selectedCount);
    btnDeleteSelected.disabled = selectedCount === 0;

    // 元に戻すボタンの状態
    if (deletedCount > 0) {
      btnUndo.style.display = 'inline-flex';
      deletedCountEl.textContent = String(deletedCount);
    } else {
      btnUndo.style.display = 'none';
    }

    // 「すべて選択」チェックボックスの状態
    if (activeCount === 0) {
      chkSelectAll.checked = false;
      chkSelectAll.indeterminate = false;
      chkSelectAll.disabled = true;
      emptyNoticeEl.style.display = 'block';
    } else {
      chkSelectAll.disabled = false;
      emptyNoticeEl.style.display = 'none';
      if (selectedCount === activeCount) {
        chkSelectAll.checked = true;
        chkSelectAll.indeterminate = false;
      } else if (selectedCount > 0) {
        chkSelectAll.checked = false;
        chkSelectAll.indeterminate = true;
      } else {
        chkSelectAll.checked = false;
        chkSelectAll.indeterminate = false;
      }
    }
  }

  function toggleSelectMessage(id, isSelected) {
    if (isSelected) {
      selectedMessageIds.add(id);
    } else {
      selectedMessageIds.delete(id);
    }
    const el = messagesEl.querySelector(`[data-msg-id="${id}"]`);
    if (el) {
      el.classList.toggle('is-selected', isSelected);
      const chk = el.querySelector('.msg-select-chk');
      if (chk) chk.checked = isSelected;
    }
    updateControlBarState();
  }

  function deleteSingleMessage(id) {
    if (deletedMessageIds.has(id)) return;
    deletedMessageIds.add(id);
    selectedMessageIds.delete(id);
    undoHistory.push({ type: 'single', ids: [id] });

    const el = messagesEl.querySelector(`[data-msg-id="${id}"]`);
    if (el) {
      el.classList.add('is-deleted');
      el.classList.remove('is-selected');
    }
    updateControlBarState();
  }

  function deleteSelectedMessages() {
    if (selectedMessageIds.size === 0) return;
    const toDelete = Array.from(selectedMessageIds);
    toDelete.forEach((id) => {
      deletedMessageIds.add(id);
      const el = messagesEl.querySelector(`[data-msg-id="${id}"]`);
      if (el) {
        el.classList.add('is-deleted');
        el.classList.remove('is-selected');
      }
    });
    selectedMessageIds.clear();
    undoHistory.push({ type: 'batch', ids: toDelete });
    updateControlBarState();
  }

  function undoLastDelete() {
    if (undoHistory.length === 0) return;
    const lastAction = undoHistory.pop();
    if (lastAction && lastAction.ids) {
      lastAction.ids.forEach((id) => {
        deletedMessageIds.delete(id);
        const el = messagesEl.querySelector(`[data-msg-id="${id}"]`);
        if (el) el.classList.remove('is-deleted');
      });
    }
    updateControlBarState();
  }

  function restoreAllMessages() {
    deletedMessageIds.clear();
    selectedMessageIds.clear();
    undoHistory.length = 0;
    messagesEl.querySelectorAll('.msg').forEach((el) => {
      el.classList.remove('is-deleted', 'is-selected');
      const chk = el.querySelector('.msg-select-chk');
      if (chk) chk.checked = false;
    });
    updateControlBarState();
  }

  function toggleSelectAll(checked) {
    const active = getActiveMessages();
    if (checked) {
      active.forEach((m) => selectedMessageIds.add(m.id));
    } else {
      selectedMessageIds.clear();
    }
    messagesEl.querySelectorAll('.msg:not(.is-deleted)').forEach((el) => {
      el.classList.toggle('is-selected', checked);
      const chk = el.querySelector('.msg-select-chk');
      if (chk) chk.checked = checked;
    });
    updateControlBarState();
  }

  // ---------------------------------------------------------------
  // 画面へのレンダリング (全形式共通)
  // ---------------------------------------------------------------
  function render(payload) {
    const { site, siteName, title, url, exportedAt, messages } = payload;

    // 各メッセージに一意のIDを付与
    messages.forEach((m, idx) => {
      if (!m.id) m.id = `msg-${idx}`;
    });

    const displayTitle = escapeText(title || 'AI会話');
    docTitleEl.textContent = displayTitle;
    document.title = displayTitle + ' - エクスポート';

    tbSiteEl.textContent = siteName || site || '-';
    tbTitleEl.textContent = displayTitle;

    messagesEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const m of messages) {
      const wrap = document.createElement('article');
      wrap.className = 'msg ' + (m.role === 'user' ? 'msg-user' : 'msg-assistant');
      wrap.setAttribute('data-msg-id', m.id);

      if (deletedMessageIds.has(m.id)) wrap.classList.add('is-deleted');
      if (selectedMessageIds.has(m.id)) wrap.classList.add('is-selected');

      // ヘッダー (ロール + 選択チェックボックス + 削除ボタン)
      const header = document.createElement('div');
      header.className = 'msg-header';

      const headerLeft = document.createElement('div');
      headerLeft.className = 'msg-header-left';

      const selectWrap = document.createElement('label');
      selectWrap.className = 'msg-select-wrap no-print';
      selectWrap.title = 'この会話を選択';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'msg-select-chk chk-custom';
      chk.setAttribute('data-msg-id', m.id);
      chk.checked = selectedMessageIds.has(m.id);
      chk.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleSelectMessage(m.id, chk.checked);
      });
      selectWrap.appendChild(chk);
      headerLeft.appendChild(selectWrap);

      const role = document.createElement('span');
      role.className = 'msg-role';
      role.textContent = ROLE_LABEL[m.role] || (siteName || 'AI');
      if (m.role === 'assistant' && siteName) {
        role.textContent = siteName;
      }
      headerLeft.appendChild(role);

      const headerRight = document.createElement('div');
      headerRight.className = 'msg-header-right no-print';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'msg-delete-btn';
      delBtn.title = 'この会話を削除して出力対象から除外';
      delBtn.innerHTML = `
        <svg class="msg-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>削除</span>
      `;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSingleMessage(m.id);
      });
      headerRight.appendChild(delBtn);

      header.appendChild(headerLeft);
      header.appendChild(headerRight);
      wrap.appendChild(header);

      const body = document.createElement('div');
      body.className = 'msg-body';
      body.innerHTML = sanitizeHtml(m.html || '');

      // ユーザー発言の冒頭に「あなたのプロンプト」ラベルが残っている場合の除去
      if (m.role === 'user') {
        cleanUserPromptLabel(body);
      }

      wrap.appendChild(body);
      frag.appendChild(wrap);
    }
    messagesEl.appendChild(frag);

    // 数式の自動レンダリング (選択中のエンジン KaTeX / MathJax)
    renderMath(messagesEl);

    // コントロールバーと件数バッジの状態更新
    updateControlBarState();
  }

  // ---------------------------------------------------------------
  // HTML形式: 自立した単一HTMLファイルを生成 (削除された会話を除外)
  // ---------------------------------------------------------------
  async function buildStandaloneHtml(payload) {
    // export.css の内容を取り込んでインライン化(単一ファイル化のため)
    let cssText = '';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const res = await fetch(chrome.runtime.getURL('export/export.css'));
        cssText = await res.text();
      } else {
        const res = await fetch('export.css');
        cssText = await res.text();
      }
    } catch (_) { /* CSS取り込み失敗時はKaTeXのみでも見た目は成立 */ }

    const displayTitle = escapeText(payload.title || 'AI会話');

    // document要素をクローンし、編集UIおよび削除されたメッセージを完全に除外
    const docClone = document.getElementById('document').cloneNode(true);
    docClone.querySelectorAll('.no-print, .edit-bar, .empty-notice, .msg-header-right, .msg-select-wrap').forEach((n) => n.remove());
    docClone.querySelectorAll('.msg.is-deleted').forEach((n) => n.remove());
    docClone.querySelectorAll('.msg.is-selected').forEach((n) => n.classList.remove('is-selected'));

    const docHtml = docClone.innerHTML;

    const mathHeadTag = currentMathEngine === 'mathjax'
      ? '<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" async></script>'
      : '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">';

    return [
      '<!DOCTYPE html>',
      '<html lang="ja">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<meta name="referrer" content="no-referrer">',
      `<title>${escapeHtml(displayTitle)}</title>`,
      mathHeadTag,
      '<style>',
      cssText,
      '/* 単一ファイル化に伴う調整: 画面用の余白のみ */',
      'body{padding:16px;}',
      '</style>',
      '</head>',
      '<body>',
      '<main class="document">',
      docHtml,
      '</main>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function downloadHtml() {
    if (!currentPayload) return;
    const html = await buildStandaloneHtml(currentPayload);
    const name = sanitizeFilename(currentPayload.title) +
      '-' + formatDateForFilename(currentPayload.exportedAt) + '.html';
    downloadBlob(html, name, 'text/html;charset=utf-8');
  }

  // ---------------------------------------------------------------
  // テキスト形式: DOM → Markdown風テキスト変換
  // ---------------------------------------------------------------

  /** 数式要素からTeXソースを取り出す(累乗や添字を確実に保持) */
  function katexToTex(katexEl, isDisplay) {
    const rawTex = getTexFromMathElement(katexEl);
    if (rawTex) {
      return isDisplay ? '\n$$\n' + rawTex + '\n$$\n' : '$' + rawTex + '$';
    }
    const ann = katexEl.querySelector('annotation[encoding="application/x-tex"], annotation');
    const tex = ann ? ann.textContent.trim() : katexEl.getAttribute('data-tex');
    if (tex) {
      return isDisplay ? '\n$$\n' + tex + '\n$$\n' : '$' + tex + '$';
    }
    return katexEl.textContent.trim();
  }

  function isInsideKatexDisplay(el) {
    return !!(el && el.closest && el.closest('.katex-display'));
  }

  /** 要素を再帰的にテキスト化 */
  function nodeToText(node, out, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent.replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    const tag = el.tagName.toLowerCase();

    // KaTeX: 最も外側のコンテナで処理(内部は再帰しない)
    if (el.classList.contains('katex-display')) {
      const inner = el.querySelector('.katex');
      out.push(katexToTex(inner || el, true));
      return;
    }
    if (el.classList.contains('katex')) {
      out.push(katexToTex(el, false));
      return;
    }
    // MathJax対応: mjx-container は alttext 属性を持つ場合がある
    if (tag === 'mjx-container') {
      const alt = el.getAttribute('alttext') || el.textContent.trim();
      const display = el.getAttribute('display') === 'true';
      out.push(display ? '\n$$\n' + alt + '\n$$\n' : '$' + alt + '$');
      return;
    }

    // 出典・引用バッジ (Gemini Notebook / NotebookLM 等)
    if (el.classList.contains('citation-badge')) {
      const txt = el.textContent.trim();
      out.push(txt.startsWith('[') ? txt : `[${txt}]`);
      return;
    }

    switch (tag) {
      case 'h1': case 'h2': case 'h3':
      case 'h4': case 'h5': case 'h6': {
        const level = parseInt(tag[1], 10);
        out.push('\n\n' + '#'.repeat(level) + ' ');
        childrenToText(el, out, ctx);
        out.push('\n\n');
        return;
      }
      case 'p':
        out.push('\n\n');
        childrenToText(el, out, ctx);
        out.push('\n\n');
        return;
      case 'br':
        out.push('\n');
        return;
      case 'li':
        out.push('\n' + '  '.repeat(ctx.listDepth || 0) + '- ');
        childrenToText(el, out, ctx);
        return;
      case 'ul': case 'ol':
        ctx.listDepth = (ctx.listDepth || 0) + 1;
        out.push('\n');
        childrenToText(el, out, ctx);
        ctx.listDepth--;
        out.push('\n');
        return;
      case 'blockquote':
        out.push('\n\n> ');
        childrenToText(el, out, ctx);
        out.push('\n\n');
        return;
      case 'pre': {
        const code = el.textContent.replace(/^\n+|\n+$/g, '');
        out.push('\n\n```\n' + code + '\n```\n\n');
        return;
      }
      case 'code':
        out.push('`' + el.textContent + '`');
        return;
      case 'table': {
        out.push('\n\n');
        for (const tr of el.querySelectorAll('tr')) {
          const cells = [...tr.children].map((c) =>
            c.textContent.replace(/\s+/g, ' ').trim());
          out.push('| ' + cells.join(' | ') + ' |\n');
        }
        out.push('\n');
        return;
      }
      case 'a': {
        const text = el.textContent.trim();
        const href = el.getAttribute('href') || '';
        if (href && text && !href.startsWith('#')) {
          out.push('[' + text + '](' + href + ')');
        } else {
          out.push(text);
        }
        return;
      }
      case 'img': {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || '画像';
        const isData = src.startsWith('data:');
        out.push('\n[画像: ' + (alt || '添付画像') + (!isData && src ? ' ' + src : '') + ']\n');
        return;
      }
      case 'hr':
        out.push('\n\n---\n\n');
        return;
      case 'script': case 'style': case 'template':
        return;
      default:
        childrenToText(el, out, ctx);
        return;
    }
  }

  function childrenToText(el, out, ctx) {
    for (const child of el.childNodes) {
      nodeToText(child, out, ctx);
    }
  }

  function messageHtmlToText(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitizeHtml(html);
    const out = [];
    const ctx = { listDepth: 0 };
    for (const child of tpl.content.childNodes) {
      nodeToText(child, out, ctx);
    }
    // 余分な空白・空行を整形
    return out.join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^ +| +$/gm, '')
      .trim();
  }

  function buildTextDocument(payload) {
    const active = getActiveMessages();
    const lines = [];
    lines.push('# ' + (payload.title || 'AI会話'));
    lines.push('');
    lines.push('サービス: ' + (payload.siteName || payload.site || '-'));
    if (payload.exportedAt) {
      lines.push('エクスポート: ' + formatDate(payload.exportedAt));
    }
    const deletedCount = deletedMessageIds.size;
    if (deletedCount > 0) {
      lines.push(`出力件数: ${active.length}件 (${deletedCount}件除外)`);
    } else {
      lines.push(`出力件数: ${active.length}件`);
    }
    if (payload.url) {
      lines.push('URL: ' + payload.url);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const m of active) {
      const role = m.role === 'user'
        ? 'あなた'
        : (payload.siteName || 'AI');
      lines.push('## ' + role);
      lines.push('');
      lines.push(messageHtmlToText(m.html || ''));
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    lines.push('Exported by AI Chat to PDF Extension');
    return lines.join('\n');
  }

  function downloadText() {
    if (!currentPayload) return;
    const text = buildTextDocument(currentPayload);
    const name = sanitizeFilename(currentPayload.title) +
      '-' + formatDateForFilename(currentPayload.exportedAt) + '.txt';
    // BOM付きで保存(Windowsのメモ帳等で文字化け防止)
    downloadBlob('﻿' + text, name, 'text/plain;charset=utf-8');
  }

  // ---------------------------------------------------------------
  // デモ用サンプル会話データ (プレビュー確認用)
  // ---------------------------------------------------------------
  const DEMO_PAYLOAD = {
    site: 'gemini',
    siteName: 'Gemini',
    title: '量子コンピュータとショアのアルゴリズムについての解説',
    url: 'https://gemini.google.com/app',
    exportedAt: new Date().toISOString(),
    messages: [
      {
        id: 'msg-0',
        role: 'user',
        html: '<p>量子コンピュータが従来の暗号通信に与える影響と、ショアのアルゴリズムの仕組みについて教えてください。</p>'
      },
      {
        id: 'msg-1',
        role: 'assistant',
        html: '<p>量子コンピュータは量子力学の重ね合わせと量子もつれを利用して計算を行うシステムです。</p>' +
              '<p>特に<strong>ショアのアルゴリズム (Shor\'s Algorithm)</strong>は、整数の素因数分解を多項式時間で解くアルゴリズムであり、RSA暗号の安全性を根本から崩す可能性があります。</p>' +
              '<p>古典アルゴリズムでの素因数分解の計算量：</p>' +
              '<p class="katex-display">$$O\\left(\\exp\\left(\\sqrt[3]{\\frac{64}{9} n (\\log n)^2}\\right)\\right)$$</p>' +
              '<p>ショアのアルゴリズムを用いた場合の計算量：</p>' +
              '<p class="katex-display">$$O(n^2 \\log n \\log \\log n)$$</p>' +
              '<p>このように多項式時間へ飛躍的に短縮されます。</p>'
      },
      {
        id: 'msg-2',
        role: 'user',
        html: '<p>量子ビット（qubit）の状態はどのように数式で表現されますか？</p>'
      },
      {
        id: 'msg-3',
        role: 'assistant',
        html: '<p>単一の量子ビットの状態 $|\\psi\\rangle$ は、基底状態 $|0\\rangle$ と $|1\\rangle$ の重ね合わせとして次のように表されます：</p>' +
              '<p class="katex-display">$$|\\psi\\rangle = \\alpha |0\\rangle + \\beta |1\\rangle \\quad (\\text{ただし } |\\alpha|^2 + |\\beta|^2 = 1)$$</p>' +
              '<p>複数の状態の確率振幅を同時に保持できることが、量子並列性の基盤となっています。</p>'
      },
      {
        id: 'msg-4',
        role: 'user',
        html: '<p>次の積分の解法について教えてください： $\\int \\frac{t^2}{(1+t^2)^2} dt$</p>'
      },
      {
        id: 'msg-5',
        role: 'assistant',
        html: '<p>被積分関数を $t \\cdot \\frac{t}{(1+t^2)^2}$ と変形し、部分積分法を適用します。</p>' +
              '<p>ここで $u = t$, $v\' = \\frac{t}{(1+t^2)^2}$ とおくと、$\\frac{dt}{dx} = 1$ かつ：</p>' +
              '<p class="katex-display">$$\\int \\frac{t^2}{(1+t^2)^2} dt = t \\cdot \\left(-\\frac{1}{2(1+t^2)}\\right) - \\int 1 \\cdot \\left(-\\frac{1}{2(1+t^2)}\\right) dt$$</p>' +
              '<p>このように、複雑な累乗や分数を含む数式も、2乗の指数や分数線が重ならずクリアに美しく描画されます。</p>'
      },
      {
        id: 'msg-6',
        role: 'user',
        html: '<p>$\\sin^2 x$ の不定積分の求め方を教えてください。</p>'
      },
      {
        id: 'msg-7',
        role: 'assistant',
        html: '<p><strong>半角の公式を利用する方法</strong></p>' +
              '<p>2倍角の公式 $\\cos 2x = 1 - 2\\sin^2 x$ から導かれる半角の公式 $\\sin^2 x = \\frac{1-\\cos 2x}{2}$ を用いて次数を下げて積分します：</p>' +
              '<p class="katex-display">$$\\begin{aligned} \\int \\sin^2 x \\, dx &= \\frac{1}{2} \\int (1 - \\cos 2x) \\, dx \\\\ &= \\frac{1}{2}\\left(x - \\frac{1}{2}\\sin 2x\\right) + C \\\\ &= \\frac{1}{2}x - \\frac{1}{4}\\sin 2x + C \\quad (C\\text{は積分定数}) \\end{aligned}$$</p>' +
              '<p>※ 2倍角の公式 $\\sin 2x = 2\\sin x \\cos x$ を代入すると、部分積分で求めた結果と一致します。</p>' +
              '<p>KaTeX または MathJax のどちらのエンジンを選択しても、ディスプレイ数式・インライン数式ともに高精度にレンダリングされ、テキストモード内の英字や注釈も美しいローマン体（立体）で表示されます。</p>'
      },
      {
        id: 'msg-8',
        role: 'user',
        html: '<p>了解です！ところで明日の天気はどうなりそうですか？（※不要な会話の例）</p>'
      },
      {
        id: 'msg-9',
        role: 'assistant',
        html: '<p>明日は全国的におおむね晴れの予報です。（※エクスポート前に選択して削除できるサンプルです）</p>'
      }
    ]
  };

  async function loadDemoPayload() {
    loadingEl.style.display = 'flex';
    loadingEl.innerHTML = '<div class="spinner"></div><p>デモ会話データを読み込んでいます…</p>';
    currentPayload = DEMO_PAYLOAD;
    render(DEMO_PAYLOAD);
    await waitForAssets();
    loadingEl.style.display = 'none';
  }

  // ---------------------------------------------------------------
  // アセット読み込み待機
  // ---------------------------------------------------------------
  async function waitForAssets() {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 5000))
      ]);
    } catch (_) { /* noop */ }

    // まだBase64化されていない外部画像があれば拡張機能のバックグラウンドSWでBase64取得
    const remoteImgs = [...document.images].filter((img) => img.src && !img.src.startsWith('data:'));
    if (remoteImgs.length > 0 && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      await Promise.allSettled(
        remoteImgs.map((img) => new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'AI2PDF_FETCH_IMAGE_BASE64', url: img.src },
            (resp) => {
              if (resp && resp.ok && resp.dataUrl) {
                img.src = resp.dataUrl;
              }
              resolve();
            }
          );
          setTimeout(resolve, 4000);
        }))
      );
    }

    const imgs = [...document.images];
    await Promise.allSettled(
      imgs.map((img) => (img.complete
        ? Promise.resolve()
        : new Promise((r) => {
            img.addEventListener('load', r, { once: true });
            img.addEventListener('error', r, { once: true });
            setTimeout(r, 4000);
          })))
    );
  }

  // ---------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------
  async function init() {
    // 形式をクエリパラメータから取得
    let isDemo = false;
    try {
      const q = new URLSearchParams(location.search);
      const f = q.get('format');
      if (f === 'pdf' || f === 'html' || f === 'text') currentFormat = f;
      if (q.get('demo') === '1' || q.get('demo') === 'true') isDemo = true;
    } catch (_) { /* noop */ }

    tbHintEl.textContent = FORMAT_HINTS[currentFormat] || FORMAT_HINTS.pdf;

    let payload = null;
    if (!isDemo) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
          const res = await chrome.storage.session.get('ai2pdf_payload');
          payload = res && res.ai2pdf_payload;
        }
      } catch (e) {
        console.error('storage read failed', e);
      }
    }

    // セッションデータが無い場合、デモデータを自動表示（またはデモボタンを提供）
    if (!payload || !payload.messages || !payload.messages.length) {
      // プレビュー画面またはWeb直接表示の場合
      currentPayload = DEMO_PAYLOAD;
      render(DEMO_PAYLOAD);
      await waitForAssets();
      loadingEl.style.display = 'none';

      // 画面上部にデモモード案内バナーを表示
      const demoBanner = document.createElement('div');
      demoBanner.className = 'no-print';
      demoBanner.style.cssText = 'background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:8px 16px;text-align:center;font-size:12px;font-weight:500;';
      demoBanner.innerHTML = '💡 <strong>プレビューモード:</strong> サンプル会話を表示しています。不要な会話の削除や選択削除、元に戻す操作を試した上で、「PDFとして保存」「HTMLを保存」「テキストを保存」をお試しいただけます。';
      document.body.insertBefore(demoBanner, document.body.firstChild);
      return;
    }

    currentPayload = payload;
    render(payload);
    await waitForAssets();
    loadingEl.style.display = 'none';

    // 抽出データは使い捨てにする(再読み込み時の誤表示防止)
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        await chrome.storage.session.remove('ai2pdf_payload');
      }
    } catch (_) { /* noop */ }
  }

  // 数式エンジン切替リスナー
  if (selectMathEngine) {
    selectMathEngine.value = currentMathEngine;
    selectMathEngine.addEventListener('change', (e) => {
      switchMathEngine(e.target.value);
    });
  }

  // 会話編集・選択ボタンのイベントリスナー
  chkSelectAll.addEventListener('change', (e) => toggleSelectAll(e.target.checked));
  btnDeleteSelected.addEventListener('click', () => deleteSelectedMessages());
  btnUndo.addEventListener('click', () => undoLastDelete());
  btnRestoreAll.addEventListener('click', () => restoreAllMessages());

  btnPrint.addEventListener('click', () => {
    const active = getActiveMessages();
    if (active.length === 0) {
      alert('出力可能な会話がありません。すべての会話が削除されています。');
      return;
    }
    window.print();
  });
  btnDlHtml.addEventListener('click', () => downloadHtml());
  btnDlText.addEventListener('click', () => downloadText());
  btnClose.addEventListener('click', () => window.close());

  init();
})();
