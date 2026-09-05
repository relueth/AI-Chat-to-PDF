/**
 * AI Chat to PDF - Popup Script
 * 現在のタブが対応サイトか判定し、content scriptに会話抽出を依頼する。
 * 抽出結果は chrome.storage.session に保存してエクスポートページへ渡す。
 */
(() => {
  'use strict';

  const SITE_INFO = {
    kimi:     { name: 'Kimi',     className: 'kimi' },
    gemini:   { name: 'Gemini',   className: 'gemini' },
    claude:   { name: 'Claude',   className: 'claude' },
    genspark: { name: 'Genspark', className: 'genspark' },
    chatgpt:  { name: 'ChatGPT',  className: 'chatgpt' },
    grok:     { name: 'Grok',     className: 'grok' }
  };

  const btn = document.getElementById('btn-export');
  const btnLabel = document.getElementById('btn-label');
  const badge = document.getElementById('site-badge');
  const statusText = document.getElementById('status-text');
  const progress = document.getElementById('progress');
  const progressText = document.getElementById('progress-text');
  const formatHint = document.getElementById('format-hint');
  const formatInputs = document.querySelectorAll('input[name="format"]');

  let activeTab = null;

  const FORMAT_INFO = {
    pdf: {
      label: '会話をPDF化する',
      hint: '数式はKaTeXの描画済みレイアウトを保持したままPDFに出力します。',
      done: 'PDFページを開きます…'
    },
    html: {
      label: 'HTMLとしてダウンロード',
      hint: 'KaTeXの数式レイアウトを含む単一HTMLファイルとして保存します。ブラウザで開いて閲覧・印刷できます。',
      done: 'HTMLページを開きます…'
    },
    text: {
      label: 'テキストとしてダウンロード',
      hint: '数式を $...$ / $$...$$ 形式のTeX記法に変換したMarkdown風テキスト(.txt)を保存します。',
      done: 'テキストを生成します…'
    }
  };

  function getSelectedFormat() {
    const checked = document.querySelector('input[name="format"]:checked');
    return (checked && checked.value) || 'pdf';
  }

  function updateFormatUI() {
    const info = FORMAT_INFO[getSelectedFormat()] || FORMAT_INFO.pdf;
    btnLabel.textContent = info.label;
    formatHint.textContent = info.hint;
  }

  for (const input of formatInputs) {
    input.addEventListener('change', updateFormatUI);
  }

  function isSupportedUrl(url) {
    try {
      const u = new URL(url);
      const h = u.hostname;
      const p = u.pathname;
      if (h === 'grok.com' || h.endsWith('.grok.com')) return true;
      if ((h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com')) &&
          (p.startsWith('/i/grok') || p.startsWith('/grok'))) return true;
      return (
        h === 'kimi.moonshot.cn' || h.endsWith('.kimi.moonshot.cn') ||
        h === 'kimi.com' || h.endsWith('.kimi.com') ||
        h === 'kimi.ai' || h.endsWith('.kimi.ai') ||
        h === 'gemini.google.com' || h.endsWith('.gemini.google.com') ||
        h === 'claude.ai' || h.endsWith('.claude.ai') ||
        h === 'genspark.ai' || h === 'www.genspark.ai' || h.endsWith('.genspark.ai') ||
        h === 'chatgpt.com' || h.endsWith('.chatgpt.com') ||
        h === 'chat.openai.com' || h.endsWith('.chat.openai.com')
      );
    } catch (_) {
      return false;
    }
  }

  function siteFromUrl(url) {
    try {
      const u = new URL(url);
      const h = u.hostname;
      const p = u.pathname;
      if (h.includes('grok.com') ||
          ((h.includes('x.com') || h.includes('twitter.com')) && (p.startsWith('/i/grok') || p.startsWith('/grok')))) {
        return 'grok';
      }
      if (h.includes('kimi')) return 'kimi';
      if (h.includes('gemini.google.com')) return 'gemini';
      if (h.includes('claude.ai')) return 'claude';
      if (h.includes('genspark.ai')) return 'genspark';
      if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'chatgpt';
    } catch (_) { /* noop */ }
    return null;
  }

  function setStatus(text, isError = false) {
    statusText.textContent = text;
    statusText.classList.toggle('error', isError);
  }

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    if (!tab || !isSupportedUrl(tab.url || '')) {
      badge.textContent = '非対応ページ';
      badge.classList.add('unsupported');
      setStatus('Kimi / Gemini / Claude / Genspark / ChatGPT / Grok の会話ページで開いてください。');
      btn.disabled = true;
      return;
    }

    const siteId = siteFromUrl(tab.url);
    const info = SITE_INFO[siteId] || { name: siteId, className: '' };
    badge.textContent = info.name;
    badge.classList.add(info.className);
    setStatus('形式を選んでボタンを押すと、会話全体を抽出して変換します。');
    btn.disabled = false;
  }

  async function ensureContentScript(tabId) {
    // content scriptが未注入(インストール直後など)の場合に手動注入
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
    } catch (_) { /* 既に注入済みの場合もある */ }
  }

  function extractWithTimeout(tabId, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      chrome.tabs.sendMessage(tabId, { type: 'AI2PDF_EXTRACT' }, (resp) => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        resolve(resp);
      });
    });
  }

  async function exportPdf() {
    if (!activeTab) return;
    btn.disabled = true;
    progress.classList.remove('hidden');
    progressText.textContent = '会話を抽出しています…';

    try {
      let resp;
      try {
        resp = await extractWithTimeout(activeTab.id, 15000);
      } catch (_) {
        // 未注入の可能性 → 手動注入してリトライ
        await ensureContentScript(activeTab.id);
        resp = await extractWithTimeout(activeTab.id, 120000);
      }

      if (!resp || !resp.ok) {
        const map = {
          NO_MESSAGES: '会話が見つかりませんでした。会話を開いた状態でもう一度お試しください。',
          UNSUPPORTED_SITE: 'このページは対応していません。',
          EXTRACT_FAILED: '抽出に失敗しました。ページを再読み込みしてお試しください。',
          TIMEOUT: '抽出がタイムアウトしました。'
        };
        setStatus(map[resp && resp.error] || '不明なエラーが発生しました。', true);
        return;
      }

      const payload = resp.data;
      const format = getSelectedFormat();
      const info = FORMAT_INFO[format] || FORMAT_INFO.pdf;
      setStatus(`${payload.messages.length} 件のメッセージを抽出しました。${info.done}`);

      // セッションストレージへ保存(大きなHTMLも扱える)
      await chrome.storage.session.set({ ai2pdf_payload: payload });

      // エクスポートページを新しいタブで開く(形式をクエリで渡す)
      const url = chrome.runtime.getURL('export/export.html') + '?format=' + encodeURIComponent(format);
      await chrome.tabs.create({ url });

      window.close();
    } catch (e) {
      setStatus('エラー: ' + (e && e.message ? e.message : String(e)), true);
    } finally {
      progress.classList.add('hidden');
      btn.disabled = false;
    }
  }

  // 抽出の進捗表示(content scriptから通知)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'AI2PDF_PROGRESS') {
      progressText.textContent = `会話を抽出しています… (${msg.count} 件)`;
    }
  });

  btn.addEventListener('click', exportPdf);
  init();
})();
