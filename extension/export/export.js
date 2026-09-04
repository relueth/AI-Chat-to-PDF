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
  const btnPrint = document.getElementById('btn-print');
  const btnDlHtml = document.getElementById('btn-dl-html');
  const btnDlText = document.getElementById('btn-dl-text');
  const btnClose = document.getElementById('btn-close');

  const ROLE_LABEL = { user: 'あなた', assistant: 'AI' };

  const FORMAT_HINTS = {
    pdf: '印刷ダイアログで「送信先 → PDFに保存」を選んでください。背景グラフィックは不要、余白は「デフォルト」推奨です。',
    html: '「HTMLを保存」で、数式レイアウトを含む単一HTMLファイルをダウンロードします。ブラウザで開いて閲覧・印刷できます。',
    text: '「テキストを保存」でMarkdown風テキスト(.txt)をダウンロードします。数式は $...$ / $$...$$ のTeX記法で出力されます。'
  };

  let currentPayload = null;
  let currentFormat = 'pdf';

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
  // HTMLサニタイズ
  // ---------------------------------------------------------------
  function sanitizeHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;

    tpl.content.querySelectorAll(
      'script, iframe, object, embed, form, link, meta, style, .visually-hidden, [class*="visually-hidden"], .cdk-visually-hidden, [class*="cdk-visually-hidden"], .sr-only, [class*="sr-only"], [class*="query-header"]'
    ).forEach((n) => n.remove());

    // 重複した「あなたのプロンプト」や「Gemini の回答」等のヘッダーを除去
    tpl.content.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"], [class*="label"]').forEach((el) => {
      if (/^(あなたのプロンプト|Your prompt|Gemini の回答|Gemini's response)/i.test(el.textContent.trim())) {
        el.remove();
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
    }
    return tpl.innerHTML;
  }

  // ---------------------------------------------------------------
  // 画面へのレンダリング (全形式共通)
  // ---------------------------------------------------------------
  function render(payload) {
    const { site, siteName, title, url, exportedAt, messages } = payload;

    const displayTitle = escapeText(title || 'AI会話');
    docTitleEl.textContent = displayTitle;
    document.title = displayTitle + ' - エクスポート';

    docMetaEl.innerHTML = '';
    docMetaEl.appendChild(document.createTextNode(`サービス: ${siteName || site || '-'}`));
    if (exportedAt) {
      docMetaEl.appendChild(document.createTextNode('　|　エクスポート: ' + formatDate(exportedAt)));
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

    tbSiteEl.textContent = siteName || site || '-';
    tbTitleEl.textContent = displayTitle;
    tbCountEl.textContent = `${messages.length} メッセージ`;

    messagesEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const m of messages) {
      const wrap = document.createElement('article');
      wrap.className = 'msg ' + (m.role === 'user' ? 'msg-user' : 'msg-assistant');

      const role = document.createElement('span');
      role.className = 'msg-role';
      role.textContent = ROLE_LABEL[m.role] || (siteName || 'AI');
      if (m.role === 'assistant' && siteName) {
        role.textContent = siteName;
      }

      const body = document.createElement('div');
      body.className = 'msg-body';
      body.innerHTML = sanitizeHtml(m.html || '');

      // ユーザー発言の冒頭に「あなたのプロンプト」ラベルが残っている場合の除去
      if (m.role === 'user') {
        const potentialHeaders = body.querySelectorAll('p, div, span, h1, h2, h3');
        for (const ph of potentialHeaders) {
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

      wrap.appendChild(role);
      wrap.appendChild(body);
      frag.appendChild(wrap);
    }
    messagesEl.appendChild(frag);
  }

  // ---------------------------------------------------------------
  // HTML形式: 自立した単一HTMLファイルを生成
  // ---------------------------------------------------------------
  async function buildStandaloneHtml(payload) {
    // export.css の内容を取り込んでインライン化(単一ファイル化のため)
    let cssText = '';
    try {
      const res = await fetch(chrome.runtime.getURL('export/export.css'));
      cssText = await res.text();
    } catch (_) { /* CSS取り込み失敗時はKaTeXのみでも見た目は成立 */ }

    const displayTitle = escapeText(payload.title || 'AI会話');
    const docHtml = document.getElementById('document').innerHTML;

    return [
      '<!DOCTYPE html>',
      '<html lang="ja">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>${escapeHtml(displayTitle)}</title>`,
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">',
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

  /** KaTeX要素からTeXソースを取り出す(なければ表示テキスト) */
  function katexToTex(katexEl, isDisplay) {
    const ann = katexEl.querySelector('annotation[encoding="application/x-tex"]');
    const tex = ann ? ann.textContent.trim() : katexEl.textContent.trim();
    if (!tex) return '';
    if (isDisplay) {
      return '\n$$\n' + tex + '\n$$\n';
    }
    return '$' + tex + '$';
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
        out.push('[画像: ' + alt + (src ? ' ' + src : '') + ']');
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
    const lines = [];
    lines.push('# ' + (payload.title || 'AI会話'));
    lines.push('');
    lines.push('サービス: ' + (payload.siteName || payload.site || '-'));
    if (payload.exportedAt) {
      lines.push('エクスポート: ' + formatDate(payload.exportedAt));
    }
    if (payload.url) {
      lines.push('URL: ' + payload.url);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const m of payload.messages) {
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
  // アセット読み込み待機
  // ---------------------------------------------------------------
  async function waitForAssets() {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 5000))
      ]);
    } catch (_) { /* noop */ }
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
    try {
      const q = new URLSearchParams(location.search);
      const f = q.get('format');
      if (f === 'pdf' || f === 'html' || f === 'text') currentFormat = f;
    } catch (_) { /* noop */ }

    tbHintEl.textContent = FORMAT_HINTS[currentFormat] || FORMAT_HINTS.pdf;

    let payload = null;
    try {
      const res = await chrome.storage.session.get('ai2pdf_payload');
      payload = res && res.ai2pdf_payload;
    } catch (e) {
      console.error('storage read failed', e);
    }

    if (!payload || !payload.messages || !payload.messages.length) {
      loadingEl.innerHTML =
        '<p style="max-width:420px;text-align:center;line-height:1.8">' +
        '会話データが見つかりません。<br>' +
        '拡張機能のポップアップから変換を実行してください。</p>';
      return;
    }

    currentPayload = payload;
    render(payload);
    await waitForAssets();
    loadingEl.style.display = 'none';

    // 抽出データは使い捨てにする(再読み込み時の誤表示防止)
    try { await chrome.storage.session.remove('ai2pdf_payload'); } catch (_) { /* noop */ }

    // 選択された形式に応じて自動実行
    setTimeout(() => {
      try {
        if (currentFormat === 'pdf') {
          window.print();
        } else if (currentFormat === 'html') {
          downloadHtml();
        } else if (currentFormat === 'text') {
          downloadText();
        }
      } catch (e) {
        console.error('auto action failed', e);
      }
    }, 400);
  }

  btnPrint.addEventListener('click', () => window.print());
  btnDlHtml.addEventListener('click', () => downloadHtml());
  btnDlText.addEventListener('click', () => downloadText());
  btnClose.addEventListener('click', () => window.close());

  init();
})();
