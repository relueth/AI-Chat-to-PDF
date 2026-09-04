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
      hosts: ['kimi.moonshot.cn', 'www.kimi.com', 'kimi.com'],
      // メッセージ単位のコンテナ
      itemSelectors: [
        '.chat-content-item',
        '[class*="chat-content-item"]',
        '[class*="message-item"]'
      ],
      // role判定: コンテナ自体または子孫がマッチするか
      userMatch: [
        '.chat-content-item-user',
        '[class*="content-item-user"]',
        '[class*="user-message"]'
      ],
      assistantMatch: [
        '.chat-content-item-assistant',
        '[class*="content-item-assistant"]',
        '[class*="bot-message"]'
      ],
      // メッセージ本文候補(見つかった最初のものを使う)
      contentSelectors: [
        '.markdown-container',
        '.markdown',
        '[class*="markdown"]',
        '[class*="message-content"]'
      ],
      titleSelectors: ['.chat-title', '[class*="chat-title"]', 'title']
    },
    {
      id: 'gemini',
      name: 'Gemini',
      hosts: ['gemini.google.com'],
      itemSelectors: ['user-query', 'model-response'],
      userMatch: ['user-query'],
      assistantMatch: ['model-response'],
      contentSelectors: [
        '.query-text',
        '.markdown.markdown-main-panel',
        '.markdown',
        'message-content',
        '[class*="response-container"]'
      ],
      userContentSelectors: ['.query-text', '[class*="query-text"]'],
      assistantContentSelectors: [
        '.markdown.markdown-main-panel',
        '.markdown',
        'message-content',
        '[class*="response-container"]'
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
      // GensparkのDOM: チャット・Copilot・Sparkpage検索に対応
      itemSelectors: [
        '[data-role="user"]',
        '[data-role="assistant"]',
        '[data-message-role="user"]',
        '[data-message-role="assistant"]',
        '[data-author="user"]',
        '[data-author="assistant"]',
        '[class*="user-query"]',
        '[class*="query-item"]',
        '[class*="query-box"]',
        '[class*="user-message"]',
        '[class*="assistant-message"]',
        '[class*="message-item"]',
        '[class*="chat-message"]',
        '[class*="conversation-item"]',
        '[class*="dialog-item"]',
        'div[class*="message_"]',
        '[class*="message-row"]',
        '[class*="chat-item"]',
        '[class*="chat-turn"]',
        '[class*="turn-item"]',
        '[class*="bubble-user"]',
        '[class*="bubble-assistant"]'
      ],
      userMatch: [
        '[data-role="user"]',
        '[data-message-role="user"]',
        '[data-author="user"]',
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
        '[class*="self"]',
        '[class*="mine"]'
      ],
      assistantMatch: [
        '[data-role="assistant"]',
        '[data-message-role="assistant"]',
        '[data-author="assistant"]',
        '[class*="assistant-message"]',
        '[class*="message-assistant"]',
        '[class*="ai-message"]',
        '[class*="bot-message"]',
        '[class*="agent-message"]',
        '[class*="from-ai"]',
        '[class*="is-ai"]',
        '[class*="assistant_message"]',
        '[class*="assistantMessage"]',
        '[class*="agent_message"]',
        '[class*="agentMessage"]',
        '[class*="model-response"]',
        '[class*="ai-response"]',
        '[class*="agent-response"]',
        '[class*="copilot-response"]',
        '[class*="bubble-assistant"]',
        '[class*="answer-box"]',
        '[class*="answer-content"]'
      ],
      userContentSelectors: [
        '[class*="query-text"]',
        '[class*="query-content"]',
        '[class*="prompt-text"]',
        '[class*="user-content"]',
        '[class*="bubble"]',
        'p'
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
    }
  ];

  // ---------------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function detectSite() {
    const host = location.hostname;
    return SITE_CONFIGS.find((c) => c.hosts.some((h) => host === h || host.endsWith('.' + h))) || null;
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
  // サニタイズ: ボタン類・ツールバーを除去しつつ数式HTMLは保持
  // ---------------------------------------------------------------
  const REMOVE_SELECTORS = [
    'button',
    '[role="button"]',
    'textarea',
    'input',
    'select',
    'svg',
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
    // スクリーンリーダー専用要素やプロンプトラベル・応答ヘッダーの除去
    '.visually-hidden',
    '[class*="visually-hidden"]',
    '.cdk-visually-hidden',
    '[class*="cdk-visually-hidden"]',
    '.sr-only',
    '[class*="sr-only"]',
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
    for (const sel of REMOVE_SELECTORS) {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
    }

    // 「あなたのプロンプト」「Your prompt」「Gemini の回答」等のヘッダー・ラベルを除去
    const headers = clone.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"], [class*="label"]');
    for (const h of headers) {
      const txt = h.textContent.trim();
      if (/^(あなたのプロンプト|Your prompt|Gemini の回答|Gemini's response)/i.test(txt)) {
        h.remove();
      }
    }

    // インラインstyleはチャット画面の配色(ダーク等)を持ち込むため除去するが、
    // KaTeX(.katex)・MathJax(mjx-*)数式の内部は vertical-align / top / height 等の
    // インラインstyleで添字・指数・分数の縦位置を調整しているため「保持」する。
    // これを除去すると添字・指数が下にずれて形が崩れる。
    const MATH_CONTAINER = '.katex, .katex-display, mjx-container, [class*="mjx-"], .MathJax';
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
          if (found && found.textContent.trim().length > 0) {
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
        if (found && found.textContent.trim().length > 0) return found;
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
            if (!text && !contentNode.querySelector('img')) continue;
            const clone = sanitizeClone(contentNode);
            results.push({
              key: hashKey(subRole + '|' + text.slice(0, 300)),
              role: subRole,
              html: clone.innerHTML
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
      if (!text && !contentNode.querySelector('img')) continue;
      const clone = sanitizeClone(contentNode);
      results.push({
        key: hashKey(role + '|' + text.slice(0, 300)),
        role,
        html: clone.innerHTML
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

  /** el が除外対象(別のmarkdownブロック内・ボタン内・AIメッセージ等)か */
  function isExcludedUserNode(el, cfg) {
    if (!el || el.nodeType !== 1) return true;
    // 別のcontentブロック自身、またはcontentブロックを内包する要素はユーザー発言ではない
    const contentSels = (cfg.assistantContentSelectors || cfg.contentSelectors || []).join(',');
    if (contentSels) {
      try {
        if (el.matches(contentSels) || el.querySelector(contentSels)) return true;
      } catch (_) { /* noop */ }
    }
    // AI/アシスタントにマッチする要素またはその子孫はユーザー発言ではない
    if (cfg.assistantMatch && cfg.assistantMatch.length) {
      const asstSel = cfg.assistantMatch.join(',');
      try {
        if (el.matches(asstSel) || el.closest(asstSel) || el.querySelector(asstSel)) return true;
      } catch (_) { /* noop */ }
    }
    // 一般的なAI・ボット・エージェント要素、ツールコール、検索ステップ等を除外
    if (el.closest('[class*="assistant"], [class*="agent"], [class*="ai-"], [class*="bot-"], [class*="model-"], [class*="search-result"], [class*="source-card"], [class*="thinking"], [class*="reasoning"], [class*="copilot"], [class*="genspark"]')) {
      return true;
    }
    if (el.closest('button, [role="button"], nav, header, footer, form, textarea, input')) return true;
    // 空 or 極端に短い/長いものは除外
    const t = el.textContent.trim();
    if (t.length === 0 && !el.querySelector('img')) return true;
    if (t.length > 3000) return true; // ユーザーの1発言としては長すぎる
    return false;
  }

  /** assistantElの直前にある「ユーザー発言」要素を探す */
  function findUserCandidate(assistantEl, cfg) {
    // 1) assistantElの最上位アシスタントコンテナを特定
    let asstTop = assistantEl;
    let curr = assistantEl;
    while (curr && curr !== document.body) {
      if (matchAny(curr, cfg.assistantMatch || []) ||
          curr.matches('[class*="assistant"], [class*="agent"], [class*="model-response"], [class*="ai-message"]')) {
        asstTop = curr;
      }
      curr = curr.parentElement;
    }

    // 2) フラット型: アシスタントコンテナの直前の兄弟を遡る
    let node = asstTop.previousElementSibling;
    let hops = 0;
    const MAX_HOPS = 10;
    while (node && hops < MAX_HOPS) {
      // ユーザーマーカーを持つ要素を優先
      if (cfg.userMatch && cfg.userMatch.length) {
        const userMarker = matchAny(node, cfg.userMatch) ? node : node.querySelector(cfg.userMatch.join(','));
        if (userMarker && !isExcludedUserNode(userMarker, cfg)) {
          return userMarker;
        }
      }
      if (!isExcludedUserNode(node, cfg)) {
        return node;
      }
      node = node.previousElementSibling;
      hops++;
    }

    // 3) ターン型: 親コンテナを遡り、「前のターンコンテナ」を探す
    let container = asstTop.parentElement;
    let depth = 0;
    while (container && container !== document.body && depth < 5) {
      let prevTurn = container.previousElementSibling;
      let turnHops = 0;
      while (prevTurn && turnHops < 5) {
        if (cfg.userMatch && cfg.userMatch.length) {
          const userMarker = matchAny(prevTurn, cfg.userMatch) ? prevTurn : prevTurn.querySelector(cfg.userMatch.join(','));
          if (userMarker && !isExcludedUserNode(userMarker, cfg)) {
            return userMarker;
          }
        }
        let containsMarkdown = false;
        try {
          containsMarkdown = !!prevTurn.querySelector((cfg.assistantContentSelectors || cfg.contentSelectors).join(','));
        } catch (_) { /* noop */ }
        if (!containsMarkdown && !isExcludedUserNode(prevTurn, cfg)) {
          return prevTurn;
        }
        prevTurn = prevTurn.previousElementSibling;
        turnHops++;
      }
      container = container.parentElement;
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
      const userEl = findUserCandidate(aiEl, cfg);
      if (userEl) {
        const userNode = findContentNode(userEl, cfg, 'user');
        const userText = userNode.textContent.trim();
        const uKey = hashKey('user|' + userText.slice(0, 300));
        if (uKey !== lastUserKey && userText.length > 0) {
          const userClone = sanitizeClone(userNode);
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

  function findInitialPageQuery() {
    const candidates = [
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
        if (text && text.length > 1 && text.length < 500 && !/^(Genspark|AI Chat|ChatGPT|Gemini|Claude|Kimi)$/i.test(text)) {
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

    // ユーザー発言が1件もない場合（Gensparkの検索・Sparkpage画面等でプロンプトがヘッダーや検索バーにある場合）
    if (ordered.length > 0 && !ordered.some((m) => m.role === 'user')) {
      const initialQuery = findInitialPageQuery();
      if (initialQuery) {
        ordered.unshift({
          key: hashKey('user|' + initialQuery.slice(0, 300)),
          role: 'user',
          html: `<p>${escapeText(initialQuery)}</p>`
        });
      }
    }

    // 取得順序の安全性チェック: user/assistantが交互でなくてもそのまま返す
    return ordered.slice(0, 800); // 安全上限
  }

  function getConversationTitle(cfg) {
    for (const sel of cfg.titleSelectors) {
      try {
        if (sel === 'title') continue;
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      } catch (_) { continue; }
    }
    const t = (document.title || '').trim();
    // "Kimi - 〜" のようなサイト名プレフィックスを軽く除去
    return t.replace(/\s*[-|–]\s*(Kimi|Gemini|Claude|Google Gemini)\s*$/i, '') || t || 'AI会話';
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
