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
        '.markdown.markdown-main-panel',
        '.markdown',
        'message-content',
        '.query-text',
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
      // GensparkのDOMは変更が多いため複数候補セレクタで広く拾う
      itemSelectors: [
        '[class*="message-item"]',
        '[class*="chat-message"]',
        '[class*="conversation-item"]',
        '[class*="dialog-item"]',
        'div[class*="message_"]',
        '[class*="message-row"]'
      ],
      userMatch: [
        '[class*="user-message"]',
        '[class*="message-user"]',
        '[class*="human-message"]',
        '[class*="from-user"]',
        '[class*="is-user"]'
      ],
      assistantMatch: [
        '[class*="assistant-message"]',
        '[class*="message-assistant"]',
        '[class*="ai-message"]',
        '[class*="bot-message"]',
        '[class*="agent-message"]',
        '[class*="from-ai"]',
        '[class*="is-ai"]'
      ],
      contentSelectors: [
        '.markdown-body',
        '[class*="markdown"]',
        '[class*="message-content"]',
        '[class*="content-body"]',
        '[class*="msg-content"]'
      ],
      titleSelectors: [
        '[class*="chat-title"]',
        '[class*="conversation-title"]',
        '[class*="session-title"]',
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
    '[aria-label*="コピー"]'
  ];

  function sanitizeClone(root) {
    const clone = root.cloneNode(true);
    for (const sel of REMOVE_SELECTORS) {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
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
  function findContentNode(item, cfg, role) {
    // Geminiのuser-queryなど本文=コンテナ自身のケースを考慮
    for (const sel of cfg.contentSelectors) {
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
      // ユーザー/AIともに「要素自身」または「子孫」でrole判定する。
      // (以前はAI側が要素自身のみだったため、ChatGPTのように
      //  article内に data-message-author-role を持つ構造で
      //  AIメッセージが誤判定・脱落していた)
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
        // 両方にマッチ(ターンコンテナ等)する場合は最も近いマーカーで決める
        const userEl = matchAny(item, cfg.userMatch) ? item : item.querySelector(cfg.userMatch.join(','));
        role = userEl ? 'user' : 'assistant';
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
  // 以前の「交互割当」方式はAI本文のみを拾うため
  // 「あなた枠にAI内容が入り、ユーザー入力が消える」問題があった。
  // ---------------------------------------------------------------

  /** el が除外対象(別のmarkdownブロック内・ボタン内等)か */
  function isExcludedUserNode(el, cfg) {
    if (!el || el.nodeType !== 1) return true;
    // 別のcontentブロック内部はユーザー発言ではない
    try {
      if (el.matches(cfg.contentSelectors.join(','))) return true;
    } catch (_) { /* noop */ }
    if (el.closest('button, [role="button"], nav, header, footer, form, textarea, input')) return true;
    // 空 or 極端に短い/長いものは除外
    const t = el.textContent.trim();
    if (t.length === 0 && !el.querySelector('img')) return true;
    if (t.length > 3000) return true; // ユーザーの1発言としては長すぎる
    return false;
  }

  /** elの直前にある「ユーザー発言らしき」要素を探す */
  function findUserCandidate(assistantEl, cfg) {
    // 1) フラット型: 同じ親内の直前の兄弟を順に遡る
    let node = assistantEl.previousElementSibling;
    let hops = 0;
    const MAX_HOPS = 5;
    while (node && hops < MAX_HOPS) {
      if (!isExcludedUserNode(node, cfg)) {
        return node;
      }
      node = node.previousElementSibling;
      hops++;
    }

    // 2) ターン型: 親コンテナを遡り、「前のターンコンテナ」をユーザー候補とする。
    //    (ユーザー発言とAI回答が別々のターン要素に入る構造向け)
    let container = assistantEl.parentElement;
    let depth = 0;
    while (container && container !== document.body && depth < 4) {
      const prevTurn = container.previousElementSibling;
      if (prevTurn) {
        // 前のターン自体がAI本文(markdown)を含む場合はユーザー発言ではない
        let containsMarkdown = false;
        try {
          containsMarkdown = !!prevTurn.querySelector(cfg.contentSelectors.join(','));
        } catch (_) { /* noop */ }
        if (!containsMarkdown && !isExcludedUserNode(prevTurn, cfg)) {
          return prevTurn;
        }
        return null; // 前のターンはあるがAI回答側 → ユーザー発言なしと判断
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
    // AI本文ブロック(=markdown系)をDOM順に拾う
    let aiBlocks = queryAllAny(document, cfg.contentSelectors);
    aiBlocks = filterOutermost(aiBlocks).filter((el) => {
      const t = el.textContent.trim();
      return t.length > 0 || el.querySelector('img');
    });
    if (aiBlocks.length === 0) return [];

    const results = [];
    let lastUserKey = null;

    for (const aiEl of aiBlocks) {
      // AIブロックの直前にユーザー発言があるか
      const userEl = findUserCandidate(aiEl, cfg);
      if (userEl) {
        const userClone = sanitizeClone(userEl);
        const userText = userEl.textContent.trim();
        const uKey = hashKey('user|' + userText.slice(0, 300));
        // 同じユーザー発言の重複挿入を防ぐ
        if (uKey !== lastUserKey) {
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

    // ユーザー発言が1つも拾えなかった場合は、
    // 交互推定より「AIのみ」の方が誤情報が少ないためそのまま返す
    return results;
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
