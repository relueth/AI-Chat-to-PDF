/**
 * AI Chat to PDF - Content Script
 * Kimi / Gemini / Claude の会話をDOMから抽出する。
 * 数式(KaTeX)はレンダリング済みHTMLをクローンするため形が崩れない。
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------
  // サイト別設定 (優先順位: Kimi > Gemini > Claude)
  // ---------------------------------------------------------------
  const SITE_CONFIGS = [
    {
      id: 'kimi',
      name: 'Kimi',
      hosts: ['kimi.moonshot.cn', 'kimi.com', 'www.kimi.com', 'kimi.ai', 'www.kimi.ai'],
      // メッセージ単位のコンテナ
      itemSelectors: [
        '.chat-content-item',
        '[class*="chat-content-item"]',
        '[class*="message-item"]',
        '[data-testid*="chat-item"]',
        '[class*="segment-item"]'
      ],
      // role判定: コンテナ自体または子孫がマッチするか
      userMatch: [
        '.chat-content-item-user',
        '[class*="content-item-user"]',
        '[class*="user-message"]',
        '[class*="segment-user"]',
        '[data-role="user"]'
      ],
      assistantMatch: [
        '.chat-content-item-assistant',
        '[class*="content-item-assistant"]',
        '[class*="bot-message"]',
        '[class*="segment-assistant"]',
        '[data-role="assistant"]'
      ],
      // メッセージ本文候補(見つかった最初のものを使う)
      contentSelectors: [
        '.markdown-container',
        '.markdown',
        '[class*="markdown"]',
        '[class*="message-content"]',
        '.segment-content'
      ],
      userContentSelectors: [
        '[class*="query-text"]',
        '[class*="user-text"]',
        '[class*="user-content"]',
        'p'
      ],
      assistantContentSelectors: [
        '.markdown-container',
        '.markdown',
        '[class*="markdown"]',
        '[class*="message-content"]'
      ],
      titleSelectors: ['.chat-title', '[class*="chat-title"]', '[data-testid*="chat-title"]', 'title']
    },
    {
      id: 'gemini-notebook',
      name: 'Gemini Notebook',
      hosts: [
        'notebook.google.com',
        'notebooklm.google.com',
        'notebooklm.google',
        'notebook.cloud.google.com',
        'gemini.google.com'
      ],
      pathFilter: (path, host) => {
        if (host.includes('gemini.google.com')) {
          return path.startsWith('/notebook') || path.startsWith('/notebooks');
        }
        return true;
      },
      itemSelectors: [
        // Gemini Notebook (NotebookLM) のチャット要素
        '.to-user-message',
        '.from-user-message',
        '[class*="to-user-message"]',
        '[class*="from-user-message"]',
        '.to-user-message-inner-content',
        '.from-user-message-inner-content',
        'chat-message',
        'chat-turn',
        'conversation-turn',
        '[class*="chat-turn"]',
        '[class*="chat-message"]',
        '[class*="message-bubble"]',
        '[class*="turn-item"]',
        '[class*="conversation-turn"]',
        '[data-role="user"]',
        '[data-role="assistant"]',
        'user-query',
        'model-response'
      ],
      userMatch: [
        '.from-user-message',
        '.from-user-message-inner-content',
        '[class*="from-user-message"]',
        '[class*="from-user"]',
        '[class*="user-query"]',
        '[class*="user-message"]',
        '[class*="query-container"]',
        '[data-role="user"]',
        'user-query'
      ],
      assistantMatch: [
        '.to-user-message',
        '.to-user-message-inner-content',
        '[class*="to-user-message"]',
        '[class*="to-user"]',
        'labs-tailwind-structural-element-view-v2',
        '[class*="assistant-message"]',
        '[class*="model-response"]',
        '[class*="response-container"]',
        '[data-role="assistant"]',
        'model-response'
      ],
      userContentSelectors: [
        '.from-user-message-inner-content',
        '[class*="from-user-message"]',
        '[class*="query-text"]',
        '[class*="user-text"]',
        '[class*="user-content"]',
        'p',
        'span'
      ],
      assistantContentSelectors: [
        '.to-user-message-inner-content',
        'labs-tailwind-structural-element-view-v2',
        'div.table-paragraph',
        '[class*="to-user-message"]',
        '.markdown-container',
        '.markdown',
        '[class*="markdown"]',
        '[class*="message-content"]',
        '[class*="response-content"]',
        'div[class*="paragraph"]'
      ],
      contentSelectors: [
        '.to-user-message-inner-content',
        '.from-user-message-inner-content',
        'labs-tailwind-structural-element-view-v2',
        'div.table-paragraph',
        '.markdown',
        '[class*="markdown"]',
        '[class*="message-content"]',
        '[class*="response-content"]',
        'div[class*="paragraph"]'
      ],
      titleSelectors: [
        'input[aria-label*="Notebook title"]',
        'input[aria-label*="ノートブックのタイトル"]',
        'input[placeholder*="Untitled notebook"]',
        'input[placeholder*="無題のノートブック"]',
        '[class*="notebook-title"]',
        '[class*="title-input"]',
        'header h1',
        'h1[class*="title"]',
        '[class*="conversation-title"]',
        'title'
      ]
    },
    {
      id: 'gemini',
      name: 'Gemini',
      hosts: ['gemini.google.com'],
      itemSelectors: [
        'user-query',
        'model-response',
        '[class*="user-query"]',
        '[class*="model-response"]',
        '[data-role="user"]',
        '[data-role="model"]',
        '[data-role="assistant"]',
        '[class*="turn-container"]',
        '[class*="conversation-turn"]'
      ],
      userMatch: [
        'user-query',
        '[class*="user-query"]',
        '[data-role="user"]'
      ],
      assistantMatch: [
        'model-response',
        '[class*="model-response"]',
        '[data-role="model"]',
        '[data-role="assistant"]'
      ],
      contentSelectors: [
        'message-content',
        '[class*="message-content"]',
        '.query-content',
        '[class*="query-content"]',
        '[class*="user-query-container"]',
        '.query-text',
        '[class*="query-text"]',
        '.markdown.markdown-main-panel',
        '.markdown',
        '[class*="response-container"]',
        '[class*="image-container"]',
        '[class*="media-carousel"]',
        'generated-image',
        'image-viewer'
      ],
      userContentSelectors: [
        '.query-content',
        '[class*="query-content"]',
        '[class*="user-query-container"]',
        'div.user-query-container',
        '.query-text',
        '[class*="query-text"]',
        '[class*="attachment"]',
        '[class*="image-container"]',
        'user-query'
      ],
      assistantContentSelectors: [
        'message-content',
        '[class*="message-content"]',
        '.markdown.markdown-main-panel',
        '.markdown',
        '[class*="response-container"]',
        'model-response'
      ],
      titleSelectors: ['.conversation-title', '[class*="conversation"] [class*="title"]', 'title']
    },
    {
      id: 'claude',
      name: 'Claude',
      hosts: ['claude.ai'],
      itemSelectors: [
        '[data-testid="user-message"]',
        '.font-claude-message',
        '[data-test-render-count]'
      ],
      userMatch: ['[data-testid="user-message"]'],
      assistantMatch: ['.font-claude-message', '[data-test-render-count]'],
      contentSelectors: [
        '.standard-markdown',
        '.progressive-markdown',
        '[class*="markdown"]'
      ],
      titleSelectors: ['[data-testid="chat-title"]', 'title']
    },
    {
      id: 'genspark',
      name: 'Genspark',
      hosts: ['www.genspark.ai', 'genspark.ai'],
      // GensparkのDOM: チャット・Copilot・Agent・Sparkpage検索に対応
      itemSelectors: [
        '[data-role="user"]',
        '[data-role="assistant"]',
        '[data-message-role="user"]',
        '[data-message-role="assistant"]',
        '[data-author="user"]',
        '[data-author="assistant"]',
        '[data-testid*="user"]',
        '[data-testid*="assistant"]',
        '[data-testid*="bot"]',
        '[class*="user-query"]',
        '[class*="query-item"]',
        '[class*="query-box"]',
        '[class*="user-message"]',
        '[class*="message-user"]',
        '[class*="user-prompt"]',
        '[class*="prompt-user"]',
        '[class*="assistant-message"]',
        '[class*="message-assistant"]',
        '[class*="chat-message"]',
        '[class*="message-item"]',
        '[class*="conversation-item"]',
        '[class*="dialog-item"]',
        'div[class*="message_"]',
        '[class*="message-row"]',
        '[class*="chat-item"]',
        '[class*="chat-turn"]',
        '[class*="turn-item"]',
        '[class*="bubble-user"]',
        '[class*="bubble-assistant"]',
        '[class*="justify-end"]',
        '[class*="items-end"]',
        '[class*="self-end"]'
      ],
      userMatch: [
        '[data-role="user"]',
        '[data-message-role="user"]',
        '[data-author="user"]',
        '[data-testid*="user"]',
        '[class*="user-message"]',
        '[class*="message-user"]',
        '[class*="human-message"]',
        '[class*="from-user"]',
        '[class*="is-user"]',
        '[class*="user-query"]',
        '[class*="userQuery"]',
        '[class*="query-text"]',
        '[class*="query-content"]',
        '[class*="query-item"]',
        '[class*="query-box"]',
        '[class*="user-prompt"]',
        '[class*="prompt-user"]',
        '[class*="chat-query"]',
        '[class*="bubble-user"]',
        '[class*="justify-end"]',
        '[class*="items-end"]',
        '[class*="self-end"]',
        '[class*="ml-auto"]'
      ],
      assistantMatch: [
        '[data-role="assistant"]',
        '[data-message-role="assistant"]',
        '[data-author="assistant"]',
        '[data-testid*="assistant"]',
        '[data-testid*="bot"]',
        '[class*="assistant-message"]',
        '[class*="assistantMessage"]',
        '[class*="message-assistant"]',
        '[class*="ai-message"]',
        '[class*="bot-message"]',
        '[class*="from-ai"]',
        '[class*="is-ai"]',
        '[class*="model-response"]',
        '[class*="ai-response"]',
        '[class*="copilot-response"]',
        '[class*="bubble-assistant"]',
        '[class*="answer-box"]',
        '[class*="answer-content"]',
        '.markdown-body',
        '[class*="markdown"]',
        '[class*="prose"]'
      ],
      userContentSelectors: [
        '[class*="query-text"]',
        '[class*="query-content"]',
        '[class*="prompt-text"]',
        '[class*="user-content"]',
        '[class*="bubble"]',
        '[class*="rounded"]',
        'p',
        'span'
      ],
      assistantContentSelectors: [
        '.markdown-body',
        '[class*="markdown"]',
        '[class*="prose"]',
        '[class*="message-content"]',
        '[class*="content-body"]',
        '[class*="answer-content"]',
        '[class*="msg-content"]'
      ],
      contentSelectors: [
        '.markdown-body',
        '[class*="markdown"]',
        '[class*="prose"]',
        '[class*="message-content"]',
        '[class*="content-body"]',
        '[class*="msg-content"]'
      ],
      titleSelectors: [
        '[class*="chat-title"]',
        '[class*="conversation-title"]',
        '[class*="session-title"]',
        '[class*="spark-title"]',
        'h1',
        'title'
      ]
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      // ChatGPTは data-message-author-role 属性でrole判定できる安定した構造
      itemSelectors: [
        '[data-message-author-role]',
        'article[data-testid^="conversation-turn"]'
      ],
      userMatch: [
        '[data-message-author-role="user"]'
      ],
      assistantMatch: [
        '[data-message-author-role="assistant"]'
      ],
      contentSelectors: [
        '.markdown.prose',
        '[class*="markdown"]',
        '.text-message',
        '[data-message-author-role]'
      ],
      titleSelectors: [
        '#page-header [class*="title"]',
        '[data-testid="conversation-title"]',
        'title'
      ]
    },
    {
      id: 'grok',
      name: 'Grok',
      hosts: ['grok.com', 'www.grok.com', 'x.com', 'twitter.com'],
      pathFilter: (path, host) => {
        if (host.includes('grok.com')) return true;
        return path.startsWith('/i/grok') || path.startsWith('/grok');
      },
      itemSelectors: [
        '[data-testid="message"]',
        '[data-testid="user-message"]',
        '[data-testid="assistant-message"]',
        '[data-testid="grokResponse"]',
        '[data-message-author-role="user"]',
        '[data-message-author-role="assistant"]',
        '.message-bubble',
        '[class*="message-bubble"]',
        '[class*="message_bubble"]',
        '[class*="messageRow"]',
        '[class*="message-row"]',
        'div[class*="chat-message"]',
        '[class*="response-content"]',
        '[class*="conversation-item"]'
      ],
      userMatch: [
        '[data-testid="user-message"]',
        '[data-message-author-role="user"]',
        '[class*="user-message"]',
        '[class*="message-user"]',
        '[class*="message-bubble"][class*="user"]',
        '[class*="bubble-user"]',
        '[class*="justify-end"]',
        '[class*="items-end"]',
        '[class*="self-end"]',
        '[class*="ml-auto"]'
      ],
      assistantMatch: [
        '[data-testid="assistant-message"]',
        '[data-testid="grokResponse"]',
        '[data-message-author-role="assistant"]',
        '.response-content-markdown',
        '[class*="response-content"]',
        '[class*="message-bubble"][class*="assistant"]',
        '[class*="message-assistant"]',
        '[class*="assistant-message"]',
        '[class*="bubble-assistant"]',
        '.prose',
        '[class*="prose"]',
        '[class*="markdown"]',
        '.markdown-body'
      ],
      contentSelectors: [
        '.response-content-markdown',
        '[class*="response-content"]',
        '.prose',
        '[class*="prose"]',
        '[class*="markdown"]',
        '.markdown-body',
        '[data-testid="message"]',
        '.message-bubble',
        '[class*="message-bubble"]',
        '[class*="message-content"]'
      ],
      userContentSelectors: [
        '[class*="query-text"]',
        '[class*="prompt-text"]',
        '[class*="user-content"]',
        '[class*="bubble"]',
        '[class*="rounded"]',
        'p',
        'span'
      ],
      assistantContentSelectors: [
        '.response-content-markdown',
        '[class*="response-content"]',
        '.prose',
        '[class*="prose"]',
        '[class*="markdown"]',
        '.markdown-body',
        '[data-testid="grokResponse"]'
      ],
      titleSelectors: [
        '[data-testid="conversation-title"]',
        '[data-testid="chat-title"]',
        'header h1',
        'header [class*="title"]',
        '[class*="conversation-title"]',
        '[class*="chat-title"]',
        'h1',
        'title'
      ]
    }
  ];

  // ---------------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function detectSite() {
    const host = location.hostname;
    const path = location.pathname;
    return SITE_CONFIGS.find((c) => {
      const matchHost = c.hosts.some((h) => host === h || host.endsWith('.' + h));
      if (!matchHost) return false;
      if (c.pathFilter && !c.pathFilter(path, host)) return false;
      return true;
    }) || null;
  }

  function matchAny(el, selectors) {
    if (!el || el.nodeType !== 1) return false;
    for (const sel of selectors) {
      try {
        if (el.matches(sel)) return true;
      } catch (_) { /* invalid selector */ }
    }
    return false;
  }

  function queryAllAny(root, selectors) {
    const seen = new Set();
    const out = [];
    for (const sel of selectors) {
      let list = [];
      try {
        list = root.querySelectorAll(sel);
      } catch (_) { continue; }
      for (const el of list) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    }
    // DOM順に並べ替え
    out.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return out;
  }

  /** ネストした重複(親も子も候補に入る)場合は最上位だけ残す */
  function filterOutermost(elements) {
    return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
  }

  /** 会話がスクロールするコンテナを推定 */
  function findScroller(anchorEl) {
    let el = anchorEl;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = getComputedStyle(el);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
        return el;
      }
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function hashKey(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    }
    return 'k' + (h >>> 0).toString(36);
  }

  // ---------------------------------------------------------------
  // 画像処理 & サニタイズ: ボタン類・ツールバーを除去しつつ数式HTMLと画像を保持
  // ---------------------------------------------------------------
  const MATH_CONTAINER = '.katex, .katex-display, mjx-container, [class*="mjx-"], .MathJax, [class*="math"], [class*="katex"], [class*="latex"], math';

  /**
   * img要素から実際のURLを取得(src, data-src, ng-reflect-src, srcset等)
   */
  function getImageSourceUrl(img) {
    if (!img) return '';
    let s = img.getAttribute('src') ||
            img.src ||
            img.getAttribute('data-src') ||
            img.getAttribute('ng-reflect-src') ||
            img.getAttribute('ng-reflect-ng-src') ||
            img.currentSrc ||
            '';
    if (s && !s.startsWith('javascript:')) return s;
    const srcset = img.getAttribute('srcset') || '';
    if (srcset) {
      const first = srcset.split(',')[0].trim().split(/\s+/)[0];
      if (first && !first.startsWith('javascript:')) return first;
    }
    return '';
  }

  /**
   * 画像要素がコンテンツ画像(ユーザー投稿画像 or AI生成・出力画像)かどうか判定
   * アバターやUIアイコン等のノイズを除去
   */
  function isContentImage(img) {
    if (!img) return false;
    // 祖先要素による除外: アバター、UIアクションバー、ナビ等(ヘッダーはプロンプトを含む場合があるため除外しない)
    if (img.closest(
      '[class*="avatar"], [class*="user-icon"], [class*="bot-icon"], ' +
      '[class*="author-avatar"], [class*="account-circle"], nav, footer'
    )) {
      return false;
    }
    const alt = (img.getAttribute('alt') || '').toLowerCase();
    // アバター専用の明確な文字列のみ除外(「profile photo of cat」等の生成プロンプト画像を除外しない)
    if (/(user avatar|assistant avatar|bot avatar|author avatar|profile avatar|account icon)/i.test(alt)) {
      return false;
    }
    const src = getImageSourceUrl(img);
    if (!src || src.startsWith('javascript:')) return false;

    // 1x1 トラッキングピクセル等の除外
    if ((img.naturalWidth === 1 && img.naturalHeight === 1) || (img.width === 1 && img.height === 1)) {
      return false;
    }

    // 極小アイコン (24px以下) の除外 (明示的な寸法がある場合)
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w > 0 && h > 0 && w <= 24 && h <= 24) {
      return false;
    }

    return true;
  }

  /**
   * 要素ツリー内の画像の属性を正規化 (src属性の補完)
   */
  function normalizeImages(root) {
    if (!root) return;
    root.querySelectorAll('img').forEach((img) => {
      const s = getImageSourceUrl(img);
      if (s && !img.getAttribute('src')) {
        img.setAttribute('src', s);
      }
    });
  }

  /**
   * CSS background-image URL を要素から取得 (ライブDOM専用)
   * ※ 切り離されたクローンでは getComputedStyle / getBoundingClientRect が
   *   機能しないため、必ずライブ要素に対して呼び出すこと。
   */
  function getBackgroundImageUrl(el) {
    if (!el || el.nodeType !== 1) return '';
    let bg = el.style ? (el.style.backgroundImage || '') : '';
    if (!bg || bg === 'none') {
      try {
        bg = getComputedStyle(el).backgroundImage || '';
      } catch (_) {
        bg = '';
      }
    }
    if (!bg || bg === 'none' || !bg.includes('url(') || bg.includes('data:image/svg')) return '';
    const match = bg.match(/url\((['"]?)(.*?)\1\)/);
    if (!match || !match[2] || match[2].startsWith('data:image/svg')) return '';
    return match[2];
  }

  /**
   * ライブDOMのbackground-imageをクローン側に<img>として復元する。
   * cloneNode(true)直後の構造が一致していることを前提に並行ウォークで対応付ける。
   * (従来はクローン側でgetComputedStyle/getBoundingClientRectを呼んでいたため
   *  常に0x0となり、Geminiの添付画像プレビュー等が一切復元されなかったバグの修正)
   */
  function restoreBackgroundImages(liveRoot, cloneRoot) {
    if (!liveRoot || !cloneRoot || liveRoot.nodeType !== 1) return;
    let liveEls, cloneEls;
    try {
      liveEls = [liveRoot, ...liveRoot.querySelectorAll('*')];
      cloneEls = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
    } catch (_) {
      return;
    }
    if (liveEls.length !== cloneEls.length) return; // 構造不一致の安全弁
    for (let i = 0; i < liveEls.length; i++) {
      const el = liveEls[i];
      if (el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'svg') continue;
      if (el.closest && el.closest(MATH_CONTAINER)) continue;
      const url = getBackgroundImageUrl(el);
      if (!url) continue;
      let rect = { width: 0, height: 0 };
      try { rect = el.getBoundingClientRect(); } catch (_) {}
      if (rect.width <= 40 || rect.height <= 40) continue;
      if (el.querySelector('img')) continue;
      const img = document.createElement('img');
      img.setAttribute('src', url);
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.borderRadius = '8px';
      cloneEls[i].appendChild(img);
    }
  }

  /**
   * ライブDOMのスコープ内からコンテンツ画像URLを収集する。
   * <img>要素に加え、CSS background-image で表示されている画像
   * (Geminiの添付画像プレビュー等) も対象とする。
   */
  function collectContentImageSources(scopeEl, opts = {}) {
    const srcs = [];
    const seen = new Set();
    if (!scopeEl || scopeEl.nodeType !== 1) return srcs;
    const excludeSel = opts.excludeSelector || null;

    const pushSrc = (s) => {
      if (s && !s.startsWith('javascript:') && !seen.has(s)) {
        seen.add(s);
        srcs.push(s);
      }
    };

    scopeEl.querySelectorAll('img').forEach((img) => {
      try {
        if (excludeSel && img.closest(excludeSel)) return;
      } catch (_) {}
      if (!isContentImage(img)) return;
      pushSrc(getImageSourceUrl(img));
    });

    // background-image ベースの画像 (ライブDOMのみ計測可能)
    scopeEl.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'svg') return;
      if (el.closest && el.closest(MATH_CONTAINER)) return;
      try {
        if (excludeSel && el.closest(excludeSel)) return;
      } catch (_) {}
      if (el.closest('[class*="avatar"], [class*="user-icon"], [class*="bot-icon"], nav, footer')) return;
      const url = getBackgroundImageUrl(el);
      if (!url) return;
      let rect = { width: 0, height: 0 };
      try { rect = el.getBoundingClientRect(); } catch (_) {}
      if (rect.width <= 40 || rect.height <= 40) return;
      if (el.querySelector('img')) return;
      pushSrc(url);
    });

    return srcs;
  }

  /**
   * クローンに含まれていないコンテンツ画像を、ライブDOM(item)から補完する。
   * Gemini では添付画像のプレビューが本文ノード(query-text等)の外側、
   * さらにターンコンテナ(user-queryの外)に配置される場合があるため、
   * user発言に限りターンコンテナまで探索範囲を広げる(AI回答側の画像は除外)。
   */
  function appendMissingImages(clone, item, cfg, role) {
    if (!clone || !item) return 0;
    const existing = new Set(
      [...clone.querySelectorAll('img')]
        .map((img) => getImageSourceUrl(img) || img.getAttribute('src'))
        .filter(Boolean)
    );

    const srcs = collectContentImageSources(item);

    // Gemini系: 添付ファイルプレビューが user-query 要素の外にあるケースへの対応
    if (role === 'user' && cfg && (cfg.id === 'gemini' || cfg.id === 'gemini-notebook')) {
      const turn = item.closest(
        '.conversation-container, [class*="conversation-container"], [class*="conversation-turn"], [class*="chat-history"] > *'
      );
      if (turn && turn !== item) {
        const extra = collectContentImageSources(turn, {
          excludeSelector: 'model-response, [class*="model-response"], [class*="response-container"], message-content'
        });
        for (const s of extra) {
          if (!srcs.includes(s)) srcs.push(s);
        }
      }
    }

    let appended = 0;
    for (const s of srcs) {
      if (existing.has(s)) continue;
      existing.add(s);
      const img = document.createElement('img');
      img.setAttribute('src', s);
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.setAttribute('loading', 'eager');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.borderRadius = '8px';
      img.style.display = 'block';
      img.style.margin = '10px 0';
      clone.appendChild(img);
      appended++;
    }
    return appended;
  }

  const REMOVE_SELECTORS = [
    'button',
    '[role="button"]',
    'textarea',
    'input',
    'select',
    '[class*="copy-code"]',
    '[class*="copy-button"]',
    '[class*="actions-bar"]',
    '[class*="message-actions"]',
    '[class*="feedback"]',
    '[data-testid*="copy"]',
    '[data-testid*="action-bar"]',
    '[aria-label*="Copy"]',
    '[aria-label*="copy"]',
    '[aria-label*="コピー"]',
    '[class*="query-header"]',
    '[class*="prompt-header"]',
    '[class*="response-header"]',
    '.query-title',
    '[class*="query-title"]',
    // Genspark等の検索プロセス・ステータス表示の除去
    '[class*="copilot-action"]',
    '[class*="source-card"]',
    '[class*="search-process"]',
    '[class*="agent-status"]',
    '[class*="spark-action"]'
  ];

  function sanitizeClone(root) {
    const clone = root.cloneNode(true);
    // background-image で表示されている画像は、切り離されたクローン側では
    // 検出できない(computed styleが空になる)ため、ライブDOMを参照して復元する
    restoreBackgroundImages(root, clone);
    normalizeImages(clone);

    // Gemini Notebook / NotebookLM の引用・出典番号バッジ(ボタン形式)を保持してsup要素に変換
    clone.querySelectorAll('button[class*="citation"], [class*="citation-chip"], [class*="citation-pill"], [class*="citation-marker"], [class*="source-citation"], [data-source-id], [data-source-index], sup button').forEach((btn) => {
      const num = btn.textContent.trim();
      if (num && /^(\d+|\[\d+\])$/.test(num)) {
        const sup = document.createElement('sup');
        sup.className = 'citation-badge';
        sup.textContent = num.startsWith('[') ? num : `[${num}]`;
        btn.replaceWith(sup);
      }
    });

    // REMOVE_SELECTORS の要素を処理: コンテンツ画像を含んでいる場合は画像を救出して要素のみ除去
    clone.querySelectorAll(REMOVE_SELECTORS.join(', ')).forEach((el) => {
      if (el.closest(MATH_CONTAINER)) return;

      const imgs = [...el.querySelectorAll('img')].filter(isContentImage);
      if (imgs.length > 0) {
        const frag = document.createDocumentFragment();
        imgs.forEach((img) => {
          const s = getImageSourceUrl(img);
          if (s) img.setAttribute('src', s);
          frag.appendChild(img);
        });
        el.replaceWith(frag);
      } else {
        el.remove();
      }
    });

    // アイコン等のSVGを除去するが、KaTeX/MathJax等の数式用SVG(根号、矢印、括弧等)は確実に保持する
    clone.querySelectorAll('svg').forEach((n) => {
      if (!n.closest(MATH_CONTAINER)) {
        n.remove();
      }
    });

    // スクリーンリーダー専用要素の除去(ただし数式コンテナ内は保持)
    clone.querySelectorAll('.visually-hidden, [class*="visually-hidden"], .cdk-visually-hidden, [class*="cdk-visually-hidden"], .sr-only, [class*="sr-only"]').forEach((n) => {
      if (!n.closest(MATH_CONTAINER)) {
        n.remove();
      }
    });

    // 「あなたのプロンプト」「Your prompt」「Gemini の回答」等のヘッダー・ラベルを除去
    const headers = clone.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"], [class*="label"]');
    for (const h of headers) {
      const txt = h.textContent.trim();
      if (/^(あなたのプロンプト|Your prompt|Gemini の回答|Gemini's response)/i.test(txt)) {
        h.remove();
      }
    }

    // 空の blockquote の除去 (添付ファイル周りや不要な縦線だけが残るのを防止)
    clone.querySelectorAll('blockquote').forEach((bq) => {
      if (!bq.textContent.trim() && !bq.querySelector('img')) {
        bq.remove();
      }
    });

    // ChatGPT等の添付ファイルカード内の仕切り線 (w-px, border-l, border-r などの空要素) を除去
    clone.querySelectorAll(
      '[class*="w-px"], [class*="h-full"][class*="w-"], [class*="divider"], [class*="separator"], hr'
    ).forEach((el) => {
      if (!el.closest(MATH_CONTAINER) && (!el.textContent.trim() || el.children.length === 0) && !el.querySelector('img')) {
        el.remove();
      }
    });

    // 空の仕切り線・縦線の除去
    clone.querySelectorAll('div, span').forEach((el) => {
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

    // インラインstyleはチャット画面の配色(ダーク等)を持ち込むため除去するが、
    // KaTeX(.katex)・MathJax(mjx-*)数式の内部は vertical-align / top / height 等の
    // インラインstyleで添字・指数・分数の縦位置を調整しているため「保持」する。
    // これを除去すると添字・指数が下にずれて形が崩れる。
    const all = [clone, ...clone.querySelectorAll('*')];
    for (const el of all) {
      if (!el.closest(MATH_CONTAINER)) {
        el.removeAttribute('style');
      }
      el.removeAttribute('data-testid');
      // リンクは新規タブで開く&絶対URL化済みのまま
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }
      if (el.tagName === 'IMG') {
        el.setAttribute('loading', 'eager');
        el.style.maxWidth = '100%';
        el.style.height = 'auto';
        el.style.borderRadius = '8px';
      }
    }
    return clone;
  }

  // ---------------------------------------------------------------
  // メッセージ抽出
  // ---------------------------------------------------------------
  function escapeText(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function findContentNode(item, cfg, role) {
    // ユーザー発言の場合、ユーザー専用セレクタを優先し、AIのmarkdownブロックを誤認しないようにする
    if (role === 'user') {
      const userSelectors = cfg.userContentSelectors || [
        '[class*="query-text"]',
        '[class*="query-content"]',
        '[class*="prompt-text"]',
        '[class*="user-text"]',
        '[class*="query"]',
        '[class*="prompt"]',
        '[class*="user-content"]',
        '[class*="bubble"]',
        'p'
      ];
      for (const sel of userSelectors) {
        try {
          if (item.matches(sel)) return item;
          const found = item.querySelector(sel);
          if (found && (found.textContent.trim().length > 0 || found.querySelector('img'))) {
            // AIのmarkdown本文を含む要素はユーザー本文として誤認しないよう除外
            const hasAiContent = !!found.querySelector('.markdown-body, [class*="markdown"], [class*="prose"]');
            if (!hasAiContent) return found;
          }
        } catch (_) { continue; }
      }
      return item;
    }

    const selectors = (role === 'assistant' && cfg.assistantContentSelectors)
      ? cfg.assistantContentSelectors
      : cfg.contentSelectors;

    for (const sel of selectors) {
      try {
        if (item.matches(sel)) return item;
        const found = item.querySelector(sel);
        if (found && (found.textContent.trim().length > 0 || found.querySelector('img'))) return found;
      } catch (_) { continue; }
    }
    return item;
  }

  function extractFromElements(cfg) {
    let items = queryAllAny(document, cfg.itemSelectors);
    items = filterOutermost(items);
    if (items.length === 0) return [];

    const results = [];
    for (const item of items) {
      const isUser = matchAny(item, cfg.userMatch) ||
        !!item.querySelector(cfg.userMatch.join(','));
      const isAssistant = matchAny(item, cfg.assistantMatch) ||
        !!item.querySelector(cfg.assistantMatch.join(','));

      let role = null;
      if (isUser && !isAssistant) {
        role = 'user';
      } else if (isAssistant && !isUser) {
        role = 'assistant';
      } else if (isUser && isAssistant) {
        // ターンコンテナ内にユーザー発言とAI回答の両方が含まれている場合
        const userEl = matchAny(item, cfg.userMatch) ? item : item.querySelector(cfg.userMatch.join(','));
        const asstEl = matchAny(item, cfg.assistantMatch) ? item : item.querySelector(cfg.assistantMatch.join(','));
        if (userEl && asstEl && userEl !== asstEl) {
          const subItems = [userEl, asstEl].sort((a, b) => {
            return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
          });
          for (const sub of subItems) {
            const subRole = sub === userEl ? 'user' : 'assistant';
            const contentNode = findContentNode(sub, cfg, subRole);
            const text = contentNode.textContent.trim();

            let clone;
            if (contentNode.tagName === 'IMG') {
              clone = document.createElement('div');
              clone.appendChild(sanitizeClone(contentNode));
            } else {
              clone = sanitizeClone(contentNode);
            }

            // 本文ノード外の添付画像・background-image画像を補完
            appendMissingImages(clone, sub, cfg, subRole);

            const cloneImgs = [...clone.querySelectorAll('img')];
            if (!text && cloneImgs.length === 0) continue;

            const imgKey = cloneImgs.length > 0 ? (cloneImgs[0].getAttribute('src') || '').slice(-30) : '';
            const htmlContent = clone.innerHTML.trim() || (clone.tagName === 'IMG' ? clone.outerHTML : '');
            results.push({
              key: hashKey(subRole + '|' + text.slice(0, 300) + '|' + imgKey),
              role: subRole,
              html: htmlContent
            });
          }
          continue;
        }
        role = userEl && !matchAny(userEl, cfg.assistantMatch) ? 'user' : 'assistant';
      }
      if (!role) {
        // 判定できない場合はスキップ(ヘッダ等の誤検出防止)
        continue;
      }
      const contentNode = findContentNode(item, cfg, role);
      const text = contentNode.textContent.trim();

      let clone;
      if (contentNode.tagName === 'IMG') {
        clone = document.createElement('div');
        clone.appendChild(sanitizeClone(contentNode));
      } else {
        clone = sanitizeClone(contentNode);
      }

      // 本文ノード外の添付画像・background-image画像を補完
      appendMissingImages(clone, item, cfg, role);

      const cloneImgs = [...clone.querySelectorAll('img')];
      if (!text && cloneImgs.length === 0) continue;

      const imgKey = cloneImgs.length > 0 ? (cloneImgs[0].getAttribute('src') || '').slice(-30) : '';
      const htmlContent = clone.innerHTML.trim() || (clone.tagName === 'IMG' ? clone.outerHTML : '');
      results.push({
        key: hashKey(role + '|' + text.slice(0, 300) + '|' + imgKey),
        role,
        html: htmlContent
      });
    }
    return results;
  }

  /** 抽出結果が「単一roleのみ」なら壊れているとみなす */
  function isDegenerate(results) {
    if (results.length === 0) return true;
    return results.every((m) => m.role === results[0].role);
  }

  // ---------------------------------------------------------------
  // 汎用フォールバック(構造ベース)
  // roleセレクタが一致しないサイト向けに、
  // 「AI本文ブロックと、その直前のユーザー発言」をペアで拾う。
  // ---------------------------------------------------------------

  /** el がユーザー発言として無効(ボタン・入力欄・ヘッダー・AI回答自身など)かを判定 */
  function isInvalidUserNode(el, assistantEl, cfg, pageTitle) {
    if (!el || el.nodeType !== 1) return true;

    // assistantEl自身、または包含関係
    if (assistantEl && (el === assistantEl || el.contains(assistantEl) || assistantEl.contains(el))) {
      return true;
    }

    // ボタン、フォーム、入力欄、ナビゲーション、ヘッダー、フッター等は除外
    if (el.closest('button, [role="button"], nav, header, footer, form, textarea, input, select, aside')) {
      return true;
    }

    // AIのMarkdown/Prose本文を含んでいるか自身がそれ
    const contentSels = (cfg.assistantContentSelectors || cfg.contentSelectors || [
      '.markdown-body', '[class*="markdown"]', '[class*="prose"]'
    ]).join(',');
    try {
      if (el.matches(contentSels) || el.querySelector(contentSels)) return true;
    } catch (_) { /* noop */ }

    // AIのアクションボタン群(コピー・評価など)を含んでいる場合は除外
    try {
      if (el.querySelector('[class*="copy"], [aria-label*="copy" i], [aria-label*="コピー"], [class*="thumb"], [class*="actions"]')) {
        return true;
      }
    } catch (_) { /* noop */ }

    // 明確なAIメッセージ要素
    const asstSels = '[data-role="assistant"], [data-message-role="assistant"], [data-author="assistant"], [class*="assistant-message"], [class*="ai-message"], [class*="bot-message"], [class*="model-response"]';
    try {
      if (el.matches(asstSels) || el.querySelector(asstSels)) return true;
    } catch (_) { /* noop */ }

    // 思考プロセス・ツール呼び出し・検索ソース
    const toolSels = '[class*="thinking"], [class*="reasoning"], [class*="source-card"], [class*="search-result"], [class*="copilot-step"]';
    try {
      if (el.matches(toolSels)) return true;
    } catch (_) { /* noop */ }

    // タイムスタンプのみの要素を除外
    const t = el.textContent.trim();
    if (t.length === 0 && !el.querySelector('img')) return true;
    if (t.length > 5000) return true;
    if (/^(\d{1,2}:\d{2}(\s*(AM|PM))?|\d+ (mins?|hours?|days?) ago)$/i.test(t)) return true;

    // ページタイトルと完全一致する場合は除外
    if (pageTitle && (t === pageTitle || t.startsWith(pageTitle + '\n'))) return true;

    return false;
  }

  function resolveUserCandidateNode(el, assistantEl, cfg, pageTitle) {
    if (!el || el.nodeType !== 1) return null;
    if (isInvalidUserNode(el, assistantEl, cfg, pageTitle)) return null;

    // 内部に明確なユーザー要素がある場合はそれを採用
    const userMatchSels = [
      '[data-role="user"]',
      '[data-message-role="user"]',
      '[data-author="user"]',
      '[data-testid*="user"]',
      '[class*="user-query"]',
      '[class*="query-text"]',
      '[class*="query-content"]',
      '[class*="user-message"]',
      '[class*="user-prompt"]',
      '[class*="bubble-user"]',
      '[class*="bubble"]',
      '[class*="justify-end"] > *',
      '[class*="items-end"] > *',
      '[class*="self-end"]'
    ];
    for (const sel of userMatchSels) {
      try {
        if (el.matches(sel) && !isInvalidUserNode(el, assistantEl, cfg, pageTitle)) {
          return el;
        }
        const inner = el.querySelector(sel);
        if (inner && !isInvalidUserNode(inner, assistantEl, cfg, pageTitle)) {
          return inner;
        }
      } catch (_) { /* noop */ }
    }

    // 内部にテキストまたは画像があり、無効判定されなければ掘り下げて返す
    const text = el.textContent.trim();
    if (text.length > 0 || el.querySelector('img')) {
      let target = el;
      while (target.children.length === 1 && target.firstElementChild && !isInvalidUserNode(target.firstElementChild, assistantEl, cfg, pageTitle)) {
        target = target.firstElementChild;
      }
      return target;
    }
    return null;
  }

  /** assistantElの直前にある「ユーザー発言」要素を探す */
  function findUserCandidate(assistantEl, cfg, pageTitle) {
    if (!assistantEl) return null;

    let curr = assistantEl;
    let depth = 0;
    while (curr && curr !== document.body && curr !== document.documentElement && depth < 6) {
      // 1) 直前の兄弟要素を遡る (フラット型レイアウト)
      let prev = curr.previousElementSibling;
      let hops = 0;
      while (prev && hops < 10) {
        const userNode = resolveUserCandidateNode(prev, assistantEl, cfg, pageTitle);
        if (userNode) {
          return userNode;
        }
        prev = prev.previousElementSibling;
        hops++;
      }

      // 2) ターンコンテナ型: 親コンテナ内で、assistantElより前にある子要素を探索
      const parent = curr.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement) {
        const userCands = queryAllAny(parent, [
          '[class*="justify-end"]',
          '[class*="items-end"]',
          '[class*="self-end"]',
          '[class*="ml-auto"]',
          '[class*="user"]',
          '[class*="prompt"]',
          '[class*="query"]',
          '[class*="bubble"]',
          '[data-role="user"]',
          '[data-message-role="user"]',
          'div', 'p'
        ]);
        const preceding = [];
        for (const cand of userCands) {
          if (cand === assistantEl || assistantEl.contains(cand) || cand.contains(assistantEl)) continue;
          const pos = cand.compareDocumentPosition(assistantEl);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
            const userNode = resolveUserCandidateNode(cand, assistantEl, cfg, pageTitle);
            if (userNode) {
              preceding.push(userNode);
            }
          }
        }
        if (preceding.length > 0) {
          return preceding[preceding.length - 1];
        }
      }

      if (curr.matches('main, [role="main"], article')) break;
      curr = curr.parentElement;
      depth++;
    }

    return null;
  }

  /**
   * 会話の構造を2パターンで推定する。
   *  A) フラット型: [user, assistant, user, assistant, ...] が同じ親に並ぶ
   *  B) ターン型:  [turn(user), turn(assistant)] や各ターン内に user/assistant が入る
   */
  function genericFallbackExtract(cfg) {
    const pageTitle = getConversationTitle(cfg);
    const selectors = cfg.assistantContentSelectors || cfg.contentSelectors;
    let aiBlocks = queryAllAny(document, selectors);
    aiBlocks = filterOutermost(aiBlocks).filter((el) => {
      const t = el.textContent.trim();
      return t.length > 0 || el.querySelector('img');
    });
    if (aiBlocks.length === 0) return [];

    const results = [];
    let lastUserKey = null;

    for (const aiEl of aiBlocks) {
      const userEl = findUserCandidate(aiEl, cfg, pageTitle);
      if (userEl) {
        const userNode = findContentNode(userEl, cfg, 'user');
        const userText = userNode.textContent.trim();
        const uKey = hashKey('user|' + userText.slice(0, 300));
        if (uKey !== lastUserKey && userText.length > 0) {
          const userClone = sanitizeClone(userNode);
          appendMissingImages(userClone, userEl, cfg, 'user');
          results.push({ key: uKey, role: 'user', html: userClone.innerHTML });
          lastUserKey = uKey;
        }
      }
      const aiClone = sanitizeClone(aiEl);
      const aiText = aiEl.textContent.trim();
      results.push({
        key: hashKey('assistant|' + aiText.slice(0, 300)),
        role: 'assistant',
        html: aiClone.innerHTML
      });
    }

    return results;
  }

  function findInitialPageQuery(cfg, pageTitle) {
    // 1) 画面上のユーザー発言バブル(右寄せ要素やbubble等)があればそれを取得
    const bubbleCands = queryAllAny(document, [
      '[class*="justify-end"] [class*="rounded"]',
      '[class*="justify-end"] p',
      '[class*="justify-end"] div',
      '[class*="items-end"] [class*="rounded"]',
      '[class*="bubble-user"]',
      '[class*="user-query"]',
      '[class*="user-message"]',
      '[class*="user-prompt"]'
    ]);
    for (const el of bubbleCands) {
      if (!isInvalidUserNode(el, null, cfg, pageTitle)) {
        const text = el.textContent.trim();
        if (text && text.length > 0 && text.length < 5000) {
          return text;
        }
      }
    }

    // 2) 検索入力欄やヘッダーのクエリ
    const candidates = [
      'textarea[data-testid="grokInput"]',
      '[data-testid="grokInput"]',
      'textarea[placeholder*="Grok" i]',
      'textarea[placeholder*="Ask" i]',
      'input[name="q"]',
      'textarea[name="q"]',
      '[class*="search-input"] input',
      '[class*="spark-title"]',
      'h1[class*="query"]',
      'h1[class*="title"]',
      '[class*="user-query"]',
      '[class*="query-text"]'
    ];
    for (const sel of candidates) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = (el.value || el.textContent || '').trim();
        if (text && text.length > 1 && text.length < 500 && !/^(Genspark|AI Chat|ChatGPT|Gemini|Claude|Kimi|Grok|xAI)$/i.test(text)) {
          return text;
        }
      } catch (_) { continue; }
    }
    return null;
  }

  /**
   * 仮想リスト(画面外のメッセージがDOMから消える)対策:
   * スクロールしながら逐次収集し、重複をキーで排除してマージする。
   */
  async function collectConversation(cfg, onProgress) {
    // まず現在レンダリングされている分でスクローラを特定
    let probe = extractFromElements(cfg);
    let anchor = null;
    if (probe.length > 0) {
      const anyItem = queryAllAny(document, cfg.itemSelectors)[0];
      anchor = anyItem || null;
    }
    const scroller = anchor ? findScroller(anchor) : (document.scrollingElement || document.documentElement);

    const seen = new Map();
    const ordered = [];

    const harvest = () => {
      const batch = extractFromElements(cfg);
      const fresh = [];
      for (const m of batch) {
        if (!seen.has(m.key)) {
          seen.set(m.key, true);
          fresh.push(m);
        }
      }
      if (fresh.length) ordered.unshift(...fresh); // 上方向に遡るので前に追加
      return fresh.length;
    };

    // 最下部へ
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(500);

    let guard = 0;
    const MAX_STEPS = 300;
    while (guard++ < MAX_STEPS) {
      harvest();
      if (onProgress) onProgress(seen.size);
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - scroller.clientHeight * 0.9);
      await sleep(350);
      const after = scroller.scrollTop;
      if (after === before || after <= 0) {
        await sleep(400);
        harvest(); // 先頭の最終収穫
        break;
      }
    }

    // 先頭まで行けなかった場合のフォールバック: 現在表示分だけでも返す
    if (ordered.length === 0) {
      const fallback = extractFromElements(cfg);
      for (const m of fallback) ordered.push(m);
    }

    // 抽出結果が壊れている(0件 or 全メッセージが単一role)場合は
    // 構造ベースの汎用抽出に切り替える。
    // ※「AI回答が あなた 枠に入りユーザー入力が消える」症状は、
    //   role判定に失敗した抽出が単一roleになることで検知できる。
    if (isDegenerate(ordered)) {
      const generic = genericFallbackExtract(cfg);
      if (generic.length > 0) {
        ordered.length = 0;
        for (const m of generic) ordered.push(m);
      }
    }

    // ユーザー発言が1件もない場合（Genspark等でプロンプトがヘッダーや検索バーにある場合）
    if (ordered.length > 0 && !ordered.some((m) => m.role === 'user')) {
      const pageTitle = getConversationTitle(cfg);
      const initialQuery = findInitialPageQuery(cfg, pageTitle);
      if (initialQuery) {
        ordered.unshift({
          key: hashKey('user|' + initialQuery.slice(0, 300)),
          role: 'user',
          html: `<p>${escapeText(initialQuery)}</p>`
        });
      }
    }

    // 抽出された全メッセージの画像をBase64形式でインライン埋め込み
    if (ordered.length > 0) {
      await embedImagesInMessages(ordered);
    }

    // 取得順序の安全性チェック: user/assistantが交互でなくてもそのまま返す
    return ordered.slice(0, 800); // 安全上限
  }

  /**
   * 画像をキャンバス経由でリサイズ・圧縮しBase64 Data URLに変換
   * (印刷用A4に十分な最大1200px、JPEG品質0.82で容量爆発を防ぐ)
   */
  function imageToDataUrlViaCanvas(img, maxDim = 1200, quality = 0.82) {
    try {
      const canvas = document.createElement('canvas');
      let width = img.naturalWidth || img.width || 0;
      let height = img.naturalHeight || img.height || 0;
      if (!width || !height) return null;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', quality);
    } catch (_) {
      // CORS taint等で失敗した場合はnullを返す
      return null;
    }
  }

  /**
   * URLからBlobを取得してData URLへ変換
   */
  async function fetchBlobToDataUrl(url) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * 画像URLを安全なサイズのBase64 Data URLに変換
   */
  async function resolveImageAsBase64(liveImg, rawSrc) {
    if (!rawSrc) return null;

    let absUrl = rawSrc;
    try {
      absUrl = new URL(rawSrc, location.href).href;
    } catch (_) {}

    // 既にBase64の場合
    if (absUrl.startsWith('data:image/')) {
      // 巨大なBase64(400KB超等)でなければそのまま使用可能
      if (absUrl.length < 400000) return absUrl;
    }

    // 1) ライブDOMのimg要素から直接Canvas描画を試行
    if (liveImg) {
      if (liveImg.complete && liveImg.naturalWidth > 0) {
        const dataUrl = imageToDataUrlViaCanvas(liveImg);
        if (dataUrl) return dataUrl;
      } else {
        // 画像読み込み完了を少し待機
        await new Promise((resolve) => {
          const done = () => resolve();
          liveImg.addEventListener('load', done, { once: true });
          liveImg.addEventListener('error', done, { once: true });
          setTimeout(done, 1500);
        });
        if (liveImg.naturalWidth > 0) {
          const dataUrl = imageToDataUrlViaCanvas(liveImg);
          if (dataUrl) return dataUrl;
        }
      }
    }

    // 2) fetch による Blob 取得 (blob: URL や same-origin / CORS対応画像)
    const fetchedDataUrl = await fetchBlobToDataUrl(absUrl);
    if (fetchedDataUrl) {
      // 一時Imageを作ってCanvasでリサイズ・最適化
      try {
        const tempImg = new Image();
        tempImg.src = fetchedDataUrl;
        await new Promise((resolve) => {
          tempImg.onload = () => resolve();
          tempImg.onerror = () => resolve();
          setTimeout(resolve, 1500);
        });
        if (tempImg.naturalWidth > 0) {
          const optimized = imageToDataUrlViaCanvas(tempImg);
          if (optimized) return optimized;
        }
      } catch (_) {}
      return fetchedDataUrl;
    }

    // 3) Background Service Worker (拡張機能権限・host_permissions) 経由での取得
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const bgResult = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'AI2PDF_FETCH_IMAGE_BASE64', url: absUrl },
            (resp) => {
              if (chrome.runtime.lastError || !resp || !resp.ok) {
                resolve(null);
              } else {
                resolve(resp.dataUrl);
              }
            }
          );
          setTimeout(() => resolve(null), 6000);
        });
        if (bgResult) return bgResult;
      }
    } catch (_) {}

    // 4) どうしても変換できなかった場合は元のURLをフォールバックとして残す
    return absUrl;
  }

  /**
   * 抽出された全メッセージの画像をBase64形式に一括変換
   */
  async function embedImagesInMessages(messages) {
    // ページ上の既存img要素を各種属性(src, currentSrc, ng-reflect-src等)ごとにマップ化(探索を高速化)
    const pageImgsBySrc = new Map();
    document.querySelectorAll('img').forEach((img) => {
      const candidates = [
        img.getAttribute('src'),
        img.src,
        img.currentSrc,
        img.getAttribute('data-src'),
        img.getAttribute('ng-reflect-src'),
        img.getAttribute('ng-reflect-ng-src'),
        getImageSourceUrl(img)
      ];
      for (const c of candidates) {
        if (c && !pageImgsBySrc.has(c)) {
          pageImgsBySrc.set(c, img);
        }
      }
    });

    // 変換結果キャッシュ (同一画像が複数箇所にあっても1回だけ変換)
    const cache = new Map();

    for (const m of messages) {
      if (!m.html || !m.html.includes('<img')) continue;

      const tpl = document.createElement('div');
      tpl.innerHTML = m.html;
      const imgs = [...tpl.querySelectorAll('img')];
      let modified = false;

      for (const img of imgs) {
        const src = getImageSourceUrl(img) || img.getAttribute('src');
        if (!src) continue;

        let base64 = cache.get(src);
        if (!base64) {
          const liveImg = pageImgsBySrc.get(src) ||
            pageImgsBySrc.get(img.getAttribute('src')) ||
            pageImgsBySrc.get(img.src);
          base64 = await resolveImageAsBase64(liveImg, src);
          if (base64) {
            cache.set(src, base64);
          }
        }

        if (base64) {
          img.setAttribute('src', base64);
          img.removeAttribute('srcset');
          img.removeAttribute('loading');
          img.removeAttribute('style');
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.style.borderRadius = '8px';
          img.style.display = 'block';
          img.style.margin = '10px 0';
          modified = true;
        }
      }

      if (modified) {
        m.html = tpl.innerHTML;
      }
    }
  }

  function getConversationTitle(cfg) {
    for (const sel of cfg.titleSelectors) {
      try {
        if (sel === 'title') continue;
        const el = document.querySelector(sel);
        if (el) {
          const val = (el.value || el.textContent || '').trim();
          if (val) return val;
        }
      } catch (_) { continue; }
    }
    const t = (document.title || '').trim();
    // "Kimi - 〜" や "〜 | Genspark" のようなサイト名プレフィックス・サフィックスを除去
    return t.replace(/\s*[-|–]\s*(Kimi|Gemini|Gemini Notebook|NotebookLM|Claude|Google Gemini|Genspark|Genspark AI|ChatGPT|Grok|xAI)\s*$/i, '')
            .replace(/^(Genspark|Genspark AI|Grok|xAI|Kimi|Gemini Notebook|NotebookLM)\s*[-|–]\s*/i, '') || t || 'AI会話';
  }

  // ---------------------------------------------------------------
  // メッセージハンドラ
  // ---------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'AI2PDF_EXTRACT') return false;

    (async () => {
      const cfg = detectSite();
      if (!cfg) {
        sendResponse({ ok: false, error: 'UNSUPPORTED_SITE' });
        return;
      }
      try {
        const messages = await collectConversation(cfg, (count) => {
          // 進捗通知(ポップアップは閉じている可能性があるので失敗は無視)
          try {
            chrome.runtime.sendMessage({ type: 'AI2PDF_PROGRESS', count });
          } catch (_) { /* noop */ }
        });
        if (!messages.length) {
          sendResponse({ ok: false, error: 'NO_MESSAGES' });
          return;
        }
        sendResponse({
          ok: true,
          data: {
            site: cfg.id,
            siteName: cfg.name,
            title: getConversationTitle(cfg),
            url: location.href,
            exportedAt: new Date().toISOString(),
            messages
          }
        });
      } catch (e) {
        sendResponse({ ok: false, error: 'EXTRACT_FAILED', detail: String(e && e.message || e) });
      }
    })();

    return true; // 非同期応答
  });
})();
