/**
 * AI Chat to PDF - Content Script
 * Kimi / Gemini / Claude の会話をDOMから抽出する。
 * 数式(KaTeX)はレンダリング済みHTMLをクローンするため形が崩れない。
 */
(() => {
  'use strict';

  // 抽出プロセス全体で共有する画像Base64キャッシュおよびライブDOM画像要素マップ
  const IMAGE_BASE64_CACHE = new Map();
  const LIVE_ELEMENT_IMAGE_MAP = new Map();

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
        '[class*="conversation-turn"]',
        '[class*="conversation-container"]',
        '[class*="user-query-container"]',
        'div.user-query-container'
      ],
      userMatch: [
        'user-query',
        '[class*="user-query"]',
        '[data-role="user"]',
        '[class*="user-prompt"]',
        '[class*="query-container"]',
        '[class*="user-query-container"]',
        '[data-test-id*="user-query"]',
        '[data-test-id*="luminous-collapsed-bubble"]',
        '[class*="user-query-bubble"]'
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
        '[class*="user-query-container"]',
        '.query-content',
        '[class*="query-content"]',
        '[data-test-id*="luminous-collapsed-bubble"]',
        '[class*="user-query-bubble"]',
        '.query-text',
        '[class*="query-text"]',
        '.markdown.markdown-main-panel',
        '.markdown',
        '[class*="response-container"]',
        '[class*="image-container"]',
        '[class*="media-carousel"]',
        'generated-image',
        'image-viewer',
        '[class*="attachment"]',
        '[class*="file-preview"]',
        '[class*="image-preview"]'
      ],
      userContentSelectors: [
        '[class*="user-query-container"]',
        'div.user-query-container',
        '.query-content',
        '[class*="query-content"]',
        '[data-test-id*="luminous-collapsed-bubble"]',
        '[class*="user-query-bubble"]',
        '.query-text',
        '[class*="query-text"]',
        '[class*="attachment"]',
        '[class*="file-preview"]',
        '[class*="file-chip"]',
        '[class*="image-preview"]',
        '[class*="image-container"]',
        '[class*="user-prompt"]',
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
    },
    {
      id: 'sakana',
      name: 'Sakana AI',
      hosts: [
        'chat.sakana.ai',
        'sakana.ai',
        'www.sakana.ai',
        'console.sakana.ai',
        'app.sakana.ai',
        'labs.sakana.ai'
      ],
      pathFilter: (path, host) => {
        if (host.includes('chat.sakana.ai') || host.includes('console.sakana.ai') || host.includes('app.sakana.ai') || host.includes('labs.sakana.ai')) return true;
        return true;
      },
      itemSelectors: [
        '[data-role="user"]',
        '[data-role="assistant"]',
        '[data-role="model"]',
        '[data-message-role="user"]',
        '[data-message-role="assistant"]',
        '[data-message-author-role="user"]',
        '[data-message-author-role="assistant"]',
        '[data-author="user"]',
        '[data-author="assistant"]',
        '[data-testid*="user"]',
        '[data-testid*="assistant"]',
        '[data-testid*="message"]',
        '[data-testid*="chat"]',
        '[class*="user-message"]',
        '[class*="assistant-message"]',
        '[class*="message-user"]',
        '[class*="message-assistant"]',
        '[class*="chat-turn"]',
        '[class*="conversation-turn"]',
        '[class*="chat-message"]',
        '[class*="message-item"]',
        '[class*="message-row"]',
        '[class*="bubble-user"]',
        '[class*="bubble-assistant"]',
        '[class*="chat-item"]',
        '[class*="turn-item"]',
        '[class*="dialog-item"]',
        'article[class*="message"]',
        'div[class*="message"]',
        '[class*="justify-end"]',
        '[class*="items-end"]',
        '[class*="self-end"]'
      ],
      userMatch: [
        '[data-role="user"]',
        '[data-message-role="user"]',
        '[data-message-author-role="user"]',
        '[data-author="user"]',
        '[data-testid*="user"]',
        '[class*="user-message"]',
        '[class*="message-user"]',
        '[class*="from-user"]',
        '[class*="is-user"]',
        '[class*="user-query"]',
        '[class*="userQuery"]',
        '[class*="query-text"]',
        '[class*="query-content"]',
        '[class*="user-prompt"]',
        '[class*="prompt-user"]',
        '[class*="bubble-user"]',
        '[class*="justify-end"]',
        '[class*="items-end"]',
        '[class*="self-end"]',
        '[class*="ml-auto"]'
      ],
      assistantMatch: [
        '[data-role="assistant"]',
        '[data-role="model"]',
        '[data-message-role="assistant"]',
        '[data-message-author-role="assistant"]',
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
        '[class*="bubble-assistant"]',
        '[class*="answer-content"]',
        '.markdown-body',
        '.prose',
        '[class*="prose"]',
        '[class*="markdown"]'
      ],
      userContentSelectors: [
        '[class*="query-text"]',
        '[class*="query-content"]',
        '[class*="prompt-text"]',
        '[class*="user-content"]',
        '[class*="user-message"]',
        '[class*="bubble"]',
        'p',
        'span'
      ],
      assistantContentSelectors: [
        '.markdown-body',
        '.prose',
        '[class*="prose"]',
        '[class*="markdown"]',
        '[class*="message-content"]',
        '[class*="response-content"]',
        '[class*="content-body"]',
        '[class*="answer-content"]'
      ],
      contentSelectors: [
        '.markdown-body',
        '.prose',
        '[class*="prose"]',
        '[class*="markdown"]',
        '[class*="message-content"]',
        '[class*="response-content"]',
        '[class*="content-body"]'
      ],
      titleSelectors: [
        '[class*="chat-title"]',
        '[class*="conversation-title"]',
        '[class*="session-title"]',
        '[data-testid*="title"]',
        'header h1',
        'h1',
        'title'
      ]
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      hosts: [
        'chat.deepseek.com',
        'deepseek.com'
      ],
      itemSelectors: [
        '.ds-message',
        '[class*="ds-message"]',
        '[class*="chat-message"]',
        '[data-role="user"]',
        '[data-role="assistant"]',
        '[class*="user-message"]',
        '[class*="assistant-message"]',
        '[class*="message-item"]',
        '[class*="message-row"]',
        '[class*="chat-turn"]',
        '[class*="conversation-turn"]',
        'div.ds-markdown',
        '[class*="ds-markdown"]'
      ],
      userMatch: [
        '[data-role="user"]',
        '[data-message-role="user"]',
        '[data-author="user"]',
        '[class*="user-message"]',
        '[class*="message-user"]',
        '[class*="from-user"]',
        '[class*="is-user"]',
        '[class*="bubble-user"]',
        '[class*="justify-end"]',
        '[class*="items-end"]',
        '[class*="self-end"]',
        '[class*="ml-auto"]'
      ],
      assistantMatch: [
        '[data-role="assistant"]',
        '[data-role="model"]',
        '[data-message-role="assistant"]',
        '[data-author="assistant"]',
        '[class*="assistant-message"]',
        '[class*="message-assistant"]',
        '[class*="from-ai"]',
        '[class*="is-ai"]',
        '.ds-markdown',
        '[class*="ds-markdown"]',
        '.markdown',
        '[class*="markdown"]',
        '.prose',
        '[class*="prose"]'
      ],
      userContentSelectors: [
        '[class*="query-text"]',
        '[class*="query-content"]',
        '[class*="prompt-text"]',
        '[class*="user-content"]',
        '[class*="user-message"]',
        '[class*="bubble"]',
        'p',
        'span'
      ],
      assistantContentSelectors: [
        '.ds-markdown',
        '[class*="ds-markdown"]',
        '.markdown-body',
        '.markdown',
        '[class*="markdown"]',
        '.prose',
        '[class*="prose"]',
        '[class*="message-content"]',
        '[class*="response-content"]'
      ],
      contentSelectors: [
        '.ds-markdown',
        '[class*="ds-markdown"]',
        '.markdown-body',
        '.markdown',
        '[class*="markdown"]',
        '.prose',
        '[class*="prose"]',
        '[class*="message-content"]'
      ],
      titleSelectors: [
        '[class*="chat-title"]',
        '[class*="conversation-title"]',
        '[class*="session-title"]',
        '[class*="history-item"][class*="active"]',
        'header h1',
        'h1',
        'title'
      ]
    },
    {
      id: 'meta-ai',
      name: 'Meta AI',
      hosts: [
        'meta.ai',
        'www.meta.ai'
      ],
      itemSelectors: [
        'div[role="article"]',
        '[role="feed"] [role="article"]',
        '[role="log"] [role="article"]',
        '[data-testid*="message"]',
        '[data-testid*="chat"]',
        '[class*="chat-message"]',
        '[class*="message-bubble"]',
        '[class*="message_bubble"]',
        '[class*="message-item"]',
        '[class*="messageRow"]',
        '[class*="message-row"]',
        '[data-role="user"]',
        '[data-role="assistant"]',
        '[class*="user-message"]',
        '[class*="assistant-message"]'
      ],
      userMatch: [
        '[data-role="user"]',
        '[data-author="user"]',
        '[data-testid*="user"]',
        '[class*="user-message"]',
        '[class*="message-user"]',
        '[class*="from-user"]',
        '[class*="is-user"]',
        '[class*="user"]',
        '[class*="justify-end"]',
        '[class*="items-end"]',
        '[class*="self-end"]',
        '[class*="ml-auto"]'
      ],
      assistantMatch: [
        '[data-role="assistant"]',
        '[data-role="model"]',
        '[data-author="assistant"]',
        '[data-testid*="assistant"]',
        '[data-testid*="bot"]',
        '[data-testid*="ai"]',
        '[data-testid*="meta"]',
        '[class*="assistant-message"]',
        '[class*="message-assistant"]',
        '[class*="ai-message"]',
        '[class*="bot-message"]',
        '[class*="from-ai"]',
        '[class*="is-ai"]',
        '[class*="markdown"]',
        '.markdown',
        '.prose',
        '[class*="prose"]'
      ],
      userContentSelectors: [
        '[class*="query-text"]',
        '[class*="prompt-text"]',
        '[class*="user-content"]',
        '[class*="bubble"]',
        '[class*="text"]',
        'p',
        'span'
      ],
      assistantContentSelectors: [
        '[class*="markdown"]',
        '.markdown',
        '.prose',
        '[class*="prose"]',
        '[class*="message-content"]',
        '[class*="response-content"]',
        '[class*="bubble"]',
        '[class*="text"]'
      ],
      contentSelectors: [
        '[class*="markdown"]',
        '.markdown',
        '.prose',
        '[class*="prose"]',
        '[class*="message-content"]',
        '[class*="response-content"]',
        '[class*="bubble"]',
        '[class*="text"]'
      ],
      titleSelectors: [
        '[role="heading"][aria-level="1"]',
        '[class*="chat-title"]',
        '[class*="conversation-title"]',
        'header h1',
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

    // 添付ファイル・プレビュー・ユーザープロンプト内の画像はアバター除外判定をバイパス
    const isAttachmentOrContent = !!img.closest(
      '[class*="attachment"], [class*="preview"], [class*="file"], [class*="upload"], ' +
      '[class*="image"], [class*="thumbnail"], [class*="media"], [class*="card"], ' +
      'user-query, [class*="user-query"], [data-test-id*="collapsed-bubble"], [class*="query-bubble"]'
    );

    if (!isAttachmentOrContent) {
      // 祖先要素による除外: アバター、ナビ、フッター等 (user-iconではなくuser-avatar/bot-avatarに限定)
      if (img.closest(
        '[class*="avatar"], [class*="user-avatar"], [class*="bot-avatar"], ' +
        '[class*="author-avatar"], [class*="account-circle"], nav, footer'
      )) {
        return false;
      }
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      // アバター専用の明確な文字列のみ除外
      if (/(user avatar|assistant avatar|bot avatar|author avatar|profile avatar|account icon)/i.test(alt)) {
        return false;
      }
    }

    const src = getImageSourceUrl(img);
    if (!src || src.startsWith('javascript:')) return false;

    // 添付ファイルや明示的コンテンツ画像(blob:, data:, googleusercontent, 添付カード内等)は寸法で除外しない
    const isExplicitContent = isAttachmentOrContent ||
      src.startsWith('blob:') ||
      src.startsWith('data:image/') ||
      src.includes('googleusercontent.com') ||
      src.includes('content.googleapis.com') ||
      src.includes('storage.googleapis.com');

    if (!isExplicitContent) {
      // 1x1 トラッキングピクセル等の除外
      if ((img.naturalWidth === 1 && img.naturalHeight === 1) || (img.width === 1 && img.height === 1)) {
        return false;
      }

      // 極小アイコン (20px以下) の除外 (明示的な寸法がある場合)
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w > 0 && h > 0 && w <= 20 && h <= 20) {
        return false;
      }
    }

    return true;
  }

  /**
   * 要素ツリー内の画像の属性を正規化し、CSS background-image からも画像を復元
   */
  function normalizeImages(root) {
    if (!root) return;
    root.querySelectorAll('img').forEach((img) => {
      const s = getImageSourceUrl(img);
      if (s && !img.getAttribute('src')) {
        img.setAttribute('src', s);
      }
    });

    // background-image から画像要素を抽出
    root.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'IMG' || el.tagName === 'SVG' || el.closest(MATH_CONTAINER)) return;
      const bg = el.style ? (el.style.backgroundImage || '') : '';
      if (bg && bg !== 'none' && !bg.includes('data:image/svg+xml')) {
        const matches = bg.matchAll(/url\(['"]?(https?:\/\/[^'")\s]+|blob:[^'")\s]+|data:image\/[^'")\s]+)['"]?\)/gi);
        for (const m of matches) {
          const url = m[1];
          if (url && !url.includes('avatar') && !url.includes('icon') && !el.querySelector('img')) {
            const img = document.createElement('img');
            img.src = url;
            img.setAttribute('src', url);
            img.setAttribute('referrerpolicy', 'no-referrer');
            img.setAttribute('loading', 'eager');
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.borderRadius = '8px';
            img.style.display = 'block';
            img.style.margin = '10px 0';
            el.appendChild(img);
            break;
          }
        }
      }
    });
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

  /**
   * レンダリング済みKaTeX DOM (.katex-html) から構造的に生TeXコードを復元
   * 累乗(^2)、添字(_n)、分数(\frac)、関数(\sin, \cos)、平方根(\sqrt)、表・行列(\begin{array})を完全に保持
   */
  function reverseParseKatexDom(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      return node.nodeValue || '';
    }
    if (node.nodeType !== 1) return '';

    const el = node;
    if (el.classList.contains('sr-only') || el.classList.contains('visually-hidden') || el.classList.contains('katex-mathml')) {
      return '';
    }

    // 表・行列: .mtable (ChatGPT / Claude 等の表組・囲み枠・array環境を二次元配列として完全復元)
    if (el.classList.contains('mtable')) {
      let colFormat = '';
      const columns = [];
      for (const child of el.children) {
        if (child.classList.contains('vertical-separator')) {
          colFormat += '|';
        } else if (child.className && String(child.className).includes('col-align-')) {
          let align = 'c';
          if (child.classList.contains('col-align-l')) align = 'l';
          else if (child.classList.contains('col-align-r')) align = 'r';
          colFormat += align;

          const cells = [];
          const rowSpans = child.querySelectorAll('.vlist > span');
          for (const rs of rowSpans) {
            const contentNodes = [...rs.childNodes].filter((cn) => !cn.classList || !cn.classList.contains('pstrut'));
            if (contentNodes.length > 0) {
              const cellTex = contentNodes.map((cn) => reverseParseKatexDom(cn)).join('').trim();
              if (cellTex) {
                cells.push(cellTex);
              }
            }
          }
          columns.push(cells);
        }
      }

      if (columns.length > 0) {
        const maxRows = Math.max(...columns.map((c) => c.length));
        const rows = [];
        for (let r = 0; r < maxRows; r++) {
          const rowCells = [];
          for (let c = 0; c < columns.length; c++) {
            rowCells.push(columns[c][r] || '');
          }
          rows.push(rowCells.join(' & '));
        }

        const parentMath = el.closest('.katex-display, .katex') || el.parentElement;
        const hasHline = parentMath && parentMath.querySelector('.katex-hline');
        const hasBorder = colFormat.includes('|') || hasHline;

        if (hasBorder) {
          // 囲み枠付きテーブル: \begin{array}{|c|c|} \hline 問 & 答え \\ \hline 1 & ... \\ \hline \end{array}
          const lines = rows.map((r, idx) => (idx === 0 ? `${r} \\\\ \\hline` : `${r} \\\\`));
          return `\\begin{array}{${colFormat || 'cc'}}\\hline ${lines.join(' ')} \\hline\\end{array}`;
        } else {
          return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
        }
      }
    }

    // 分数: .mfrac
    if (el.classList.contains('mfrac')) {
      const parts = [...el.children].filter((c) => !c.classList.contains('frac-line'));
      if (parts.length >= 2) {
        const num = reverseParseKatexDom(parts[0]).trim();
        const den = reverseParseKatexDom(parts[1]).trim();
        return `\\frac{${num}}{${den}}`;
      }
    }

    // 平方根: .msqrt
    if (el.classList.contains('msqrt')) {
      const body = el.querySelector('.vlist-t, .svg-align, .root') || el;
      return `\\sqrt{${reverseParseKatexDom(body).trim()}}`;
    }

    // 上付き・下付き添字: .msupsub
    if (el.classList.contains('msupsub')) {
      let sup = '';
      let sub = '';
      const rList = el.querySelectorAll('.vlist-r');
      if (rList.length === 1) {
        const topEl = rList[0].querySelector('[style*="top"]');
        const st = topEl ? (topEl.getAttribute('style') || '') : '';
        if (st.includes('top:-') || st.includes('top: -')) {
          sup = reverseParseKatexDom(rList[0]).trim();
        } else {
          sub = reverseParseKatexDom(rList[0]).trim();
        }
      } else if (rList.length >= 2) {
        sup = reverseParseKatexDom(rList[0]).trim();
        sub = reverseParseKatexDom(rList[1]).trim();
      } else {
        sup = el.textContent.trim();
      }

      let res = '';
      if (sub) res += `_{${sub}}`;
      if (sup) res += `^{${sup}}`;
      return res;
    }

    // 関数名: .mop (sin, cos, tan, log 等)
    if (el.classList.contains('mop')) {
      const name = el.textContent.trim();
      const MATH_FUNCS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
                          'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'det', 'dim', 'ker',
                          'deg', 'gcd', 'hom', 'inf', 'sup', 'lim', 'max', 'min', 'arg'];
      if (MATH_FUNCS.includes(name.toLowerCase())) {
        return `\\${name} `;
      }
      return name;
    }

    // 日本語・CJKフォールバック文字
    if (el.classList.contains('cjk_fallback')) {
      const cjk = el.textContent.trim();
      if (cjk) return `\\text{${cjk}}`;
    }

    // 特殊数学記号の復元
    const t = el.textContent.trim();
    if (el.children.length === 0) {
      if (t === '⊗') return '\\otimes ';
      if (t === '×') return '\\times ';
      if (t === '÷') return '\\div ';
      if (t === '±') return '\\pm ';
      if (t === '≤') return '\\le ';
      if (t === '≥') return '\\ge ';
      if (t === '≠') return '\\neq ';
      if (t === '∞') return '\\infty ';
      if (t === '·') return '\\cdot ';
    }

    let out = '';
    for (const child of el.childNodes) {
      out += reverseParseKatexDom(child);
    }
    return out;
  }

  /**
   * 数式要素 (KaTeX, MathJax, MathML 等) から生TeXコードを安全に抽出し、
   * data-tex 属性に永続退避する (累乗^2、添字_n、分数等の脱落を完全防止)
   */
  function preserveAllMathData(root) {
    if (!root) return;

    // 1. 最上位の数式コンテナのみを抽出 (入れ子の math や annotation 等の子要素への重複タグ付けを防止)
    const mathElements = root.querySelectorAll(
      '.katex-display, [class*="katex-display"], .katex, [class*="katex"], .math-display, .math-inline, [class*="math-display"], [class*="math-inline"], [class*="language-math"], [class*="language-latex"], mjx-container, math, [data-tex], [data-latex], [data-math]'
    );

    const outermost = [];
    for (const el of mathElements) {
      if (el.closest('.katex-mathml')) continue;
      let isDescendant = false;
      for (const parent of outermost) {
        if (parent.contains(el) && parent !== el) {
          isDescendant = true;
          break;
        }
      }
      if (!isDescendant) {
        outermost.push(el);
      }
    }

    for (const el of outermost) {
      if (el.getAttribute('data-tex')) continue;

      let raw = '';
      // A. 直近の属性
      const attrTex = el.getAttribute('data-tex') || el.getAttribute('data-latex') || el.getAttribute('data-math') ||
                      el.getAttribute('data-original-tex') || el.getAttribute('alttext') || el.getAttribute('aria-label');
      if (attrTex && attrTex.trim()) {
        raw = attrTex.trim();
      }

      // B. annotation タグ
      if (!raw) {
        const ann = el.querySelector('annotation[encoding="application/x-tex"], annotation');
        if (ann && ann.textContent.trim()) {
          raw = ann.textContent.trim();
        }
      }

      // C. MathML alttext
      if (!raw) {
        const mathEl = el.querySelector('math') || (el.tagName && el.tagName.toLowerCase() === 'math' ? el : null);
        if (mathEl) {
          const mAlt = mathEl.getAttribute('alttext');
          if (mAlt && mAlt.trim()) raw = mAlt.trim();
        }
      }

      // D. KaTeX HTML からの構造的復元
      if (!raw && (el.classList.contains('katex') || el.classList.contains('katex-display') || el.querySelector('.katex-html'))) {
        const katexHtml = el.querySelector('.katex-html') || el;
        const parsed = reverseParseKatexDom(katexHtml).trim();
        if (parsed) raw = parsed;
      }

      if (raw) {
        el.setAttribute('data-tex', raw);
      }
    }
  }

  function sanitizeClone(root) {
    // ライブ要素側で画像URL・数式生TeXを属性に書き込んでクローン時の脱落を防止
    normalizeImages(root);
    preserveAllMathData(root);

    const clone = root.cloneNode(true);
    normalizeImages(clone);
    preserveAllMathData(clone);

    // 生TeX退避後に .katex-mathml および annotation を除去 (重複描画・二重文字の完全防止)
    clone.querySelectorAll('.katex-mathml, annotation').forEach((n) => n.remove());

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

    // REMOVE_SELECTORS の要素を処理: 添付ファイルや画像を含む場合は画像を保護・救出
    clone.querySelectorAll(REMOVE_SELECTORS.join(', ')).forEach((el) => {
      if (el.closest(MATH_CONTAINER)) return;
      if (el.tagName === 'IMG') return; // imgタグ自体は絶対に除去しない

      // 添付・メディア・画像・カード要素の場合はボタン属性のみ解除して要素と中身を保護
      if (el.matches('[class*="attachment"], [class*="thumbnail"], [class*="preview"], [class*="image"], [class*="file"], [class*="chip"], [class*="media"], [class*="upload"], [class*="card"]')) {
        el.removeAttribute('role');
        el.removeAttribute('tabindex');
        el.removeAttribute('aria-label');
        if (el.tagName === 'BUTTON') {
          const div = document.createElement('div');
          while (el.firstChild) div.appendChild(el.firstChild);
          el.replaceWith(div);
        }
        return;
      }

      // 要素内の画像（img, canvas, background-image）を救出
      const rescued = [];
      el.querySelectorAll('img').forEach((img) => {
        const s = getImageSourceUrl(img);
        if (s && !s.includes('avatar') && !s.includes('account_circle')) {
          const newImg = document.createElement('img');
          newImg.setAttribute('src', s);
          newImg.setAttribute('loading', 'eager');
          newImg.style.maxWidth = '100%';
          newImg.style.height = 'auto';
          newImg.style.borderRadius = '8px';
          newImg.style.display = 'block';
          newImg.style.margin = '10px 0';
          rescued.push(newImg);
        }
      });
      el.querySelectorAll('*').forEach((sub) => {
        const bg = sub.style ? sub.style.backgroundImage : '';
        const m = bg.match(/url\(['"]?(https?:\/\/[^'")\s]+|blob:[^'")\s]+|data:image\/[^'")\s]+)['"]?\)/i);
        if (m && m[1] && !m[1].includes('avatar') && !m[1].includes('account_circle')) {
          const newImg = document.createElement('img');
          newImg.setAttribute('src', m[1]);
          newImg.setAttribute('loading', 'eager');
          newImg.style.maxWidth = '100%';
          newImg.style.height = 'auto';
          newImg.style.borderRadius = '8px';
          newImg.style.display = 'block';
          newImg.style.margin = '10px 0';
          rescued.push(newImg);
        }
      });

      if (rescued.length > 0) {
        const frag = document.createDocumentFragment();
        rescued.forEach((r) => frag.appendChild(r));
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

    // MathML annotation (生TeXテキスト注釈) を親要素・子要素の data-tex 属性に確実に退避
    // これにより、MathJax切替時やテキスト出力時に累乗(^2)や添字を保持した高精度な生TeXコードを再利用できる
    preserveAllMathData(clone);

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

  /**
   * 要素ツリー(Shadow DOM含む)の全要素を走査
   */
  function getAllElementsWithShadow(root) {
    const list = [];
    const queue = [root];
    while (queue.length > 0) {
      const el = queue.shift();
      if (!el || el.nodeType !== 1) continue;
      list.push(el);
      if (el.shadowRoot) {
        for (const child of el.shadowRoot.children) {
          queue.push(child);
        }
      }
      for (const child of el.children) {
        queue.push(child);
      }
    }
    return list;
  }

  /**
   * ライブDOM要素から画像(img, background-image, canvas, svg image)を網羅的に抽出し、
   * 読み込み完了しているものは即座にCanvas経由でBase64化する
   */
  function extractLiveImages(root, role = 'user') {
    if (!root) return [];
    const collected = [];
    const seenSrcs = new Set();
    const all = getAllElementsWithShadow(root);

    for (const el of all) {
      if (el.closest && el.closest(MATH_CONTAINER)) continue;
      // ユーザー発言探索時、AI応答コンテナ内の画像は誤取得しない
      if (role === 'user' && el.closest && el.closest('model-response, [class*="model-response"], [data-role="model"], [data-role="assistant"], .markdown-body, [class*="markdown"]')) {
        continue;
      }

      // 1. img要素
      if (el.tagName === 'IMG') {
        if (!isContentImage(el)) continue;
        const src = getImageSourceUrl(el);
        if (!src || seenSrcs.has(src)) continue;
        seenSrcs.add(src);

        // ライブDOMで既に読み込み完了していれば即座にBase64化
        let b64 = IMAGE_BASE64_CACHE.get(src) || IMAGE_BASE64_CACHE.get(el.src) || null;
        if (!b64 && el.complete && (el.naturalWidth > 0 || el.width > 0)) {
          b64 = imageToDataUrlViaCanvas(el);
          if (b64) {
            IMAGE_BASE64_CACHE.set(src, b64);
            if (el.src) IMAGE_BASE64_CACHE.set(el.src, b64);
          }
        }
        LIVE_ELEMENT_IMAGE_MAP.set(src, el);
        if (el.src) LIVE_ELEMENT_IMAGE_MAP.set(el.src, el);
        collected.push({ el, src: b64 || src, base64: b64 });
        continue;
      }

      // 2. canvas 要素
      if (el.tagName === 'CANVAS') {
        const w = el.width || el.clientWidth || 0;
        const h = el.height || el.clientHeight || 0;
        if (w > 20 && h > 20) {
          try {
            const dataUrl = el.toDataURL('image/jpeg', 0.85);
            if (dataUrl && !seenSrcs.has(dataUrl)) {
              seenSrcs.add(dataUrl);
              const syntheticImg = document.createElement('img');
              syntheticImg.setAttribute('src', dataUrl);
              syntheticImg.setAttribute('loading', 'eager');
              syntheticImg.style.maxWidth = '100%';
              syntheticImg.style.height = 'auto';
              syntheticImg.style.borderRadius = '8px';
              syntheticImg.style.display = 'block';
              IMAGE_BASE64_CACHE.set(dataUrl, dataUrl);
              collected.push({ el: syntheticImg, src: dataUrl, base64: dataUrl });
            }
          } catch (_) {}
        }
        continue;
      }

      // 3. SVG image 要素
      if (el.tagName && el.tagName.toLowerCase() === 'image') {
        const src = el.getAttribute('href') || el.getAttribute('xlink:href') || el.getAttribute('src');
        if (src && !seenSrcs.has(src) && !src.includes('avatar') && !src.includes('icon')) {
          seenSrcs.add(src);
          const syntheticImg = document.createElement('img');
          syntheticImg.setAttribute('src', src);
          syntheticImg.setAttribute('loading', 'eager');
          syntheticImg.style.maxWidth = '100%';
          syntheticImg.style.height = 'auto';
          syntheticImg.style.borderRadius = '8px';
          syntheticImg.style.display = 'block';
          collected.push({ el: syntheticImg, src, base64: null });
        }
        continue;
      }

      // 4. CSS background-image (inline, computed, ::before, ::after)
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        let bgs = [el.style ? el.style.backgroundImage : ''];
        try {
          const cs = window.getComputedStyle(el);
          if (cs && cs.backgroundImage) bgs.push(cs.backgroundImage);
          const csBefore = window.getComputedStyle(el, '::before');
          if (csBefore && csBefore.backgroundImage) bgs.push(csBefore.backgroundImage);
          const csAfter = window.getComputedStyle(el, '::after');
          if (csAfter && csAfter.backgroundImage) bgs.push(csAfter.backgroundImage);
        } catch (_) {}

        for (const bg of bgs) {
          if (!bg || bg === 'none') continue;
          const matches = bg.matchAll(/url\(['"]?(https?:\/\/[^'")\s]+|blob:[^'")\s]+|data:image\/[^'")\s]+)['"]?\)/gi);
          for (const m of matches) {
            const url = m[1];
            if (!url || seenSrcs.has(url) || url.includes('data:image/svg')) continue;
            if (url.includes('avatar') || url.includes('account_circle') || url.includes('profile')) continue;

            const isExplicit = url.startsWith('blob:') || url.startsWith('data:image/') || url.includes('googleusercontent.com');
            const w = el.offsetWidth || el.clientWidth || 0;
            const h = el.offsetHeight || el.clientHeight || 0;
            if (isExplicit || (w > 20 && h > 20) || (w === 0 && h === 0)) {
              seenSrcs.add(url);
              const syntheticImg = document.createElement('img');
              syntheticImg.setAttribute('src', url);
              syntheticImg.setAttribute('loading', 'eager');
              syntheticImg.setAttribute('referrerpolicy', 'no-referrer');
              syntheticImg.style.maxWidth = '100%';
              syntheticImg.style.height = 'auto';
              syntheticImg.style.borderRadius = '8px';
              syntheticImg.style.display = 'block';
              syntheticImg.style.margin = '10px 0';
              LIVE_ELEMENT_IMAGE_MAP.set(url, syntheticImg);
              collected.push({ el: syntheticImg, src: url, base64: null });
            }
          }
        }
      }

      // 5. カスタム属性 (data-src, data-url, image-url, preview-url 等)
      if (el.matches && el.matches('[class*="attachment"], [class*="thumbnail"], [class*="preview"], [class*="image"], [class*="file"], [class*="media"], [class*="upload"], [class*="card"]')) {
        const customUrl = el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('image-url') || el.getAttribute('preview-url') || el.getAttribute('data-thumbnail');
        if (customUrl && !seenSrcs.has(customUrl) && (customUrl.startsWith('http') || customUrl.startsWith('blob:') || customUrl.startsWith('data:'))) {
          seenSrcs.add(customUrl);
          const syntheticImg = document.createElement('img');
          syntheticImg.setAttribute('src', customUrl);
          syntheticImg.setAttribute('loading', 'eager');
          syntheticImg.style.maxWidth = '100%';
          syntheticImg.style.height = 'auto';
          syntheticImg.style.borderRadius = '8px';
          syntheticImg.style.display = 'block';
          LIVE_ELEMENT_IMAGE_MAP.set(customUrl, syntheticImg);
          collected.push({ el: syntheticImg, src: customUrl, base64: null });
        }
      }
    }

    return collected;
  }

  /**
   * 単一メッセージ要素からテキストと画像を抽出し、正規化クローンを生成
   */
  function processMessageItem(targetEl, role, cfg, contextContainer = null) {
    const contentNode = findContentNode(targetEl, cfg, role);
    const candidateRoots = [targetEl];

    // ユーザー発言の場合、親コンテナや近傍の添付ファイル要素も画像探索対象に含める
    if (role === 'user') {
      // 1. 親コンテナを遡ってターン全体を含める
      let cur = targetEl.parentElement;
      for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
        if (!candidateRoots.includes(cur)) candidateRoots.push(cur);
        if (cur.matches('[class*="turn"], [class*="conversation-container"], [class*="conversation-turn"], [class*="message-container"]')) {
          break;
        }
        cur = cur.parentElement;
      }
      if (contextContainer && !candidateRoots.includes(contextContainer)) {
        candidateRoots.push(contextContainer);
      }

      // 2. targetEl および親要素の兄弟要素を探索
      const checkSiblings = (el) => {
        if (!el) return;
        let sib = el.previousElementSibling;
        let c = 0;
        while (sib && c++ < 6) {
          if (!candidateRoots.includes(sib)) candidateRoots.push(sib);
          sib = sib.previousElementSibling;
        }
        sib = el.nextElementSibling;
        c = 0;
        while (sib && c++ < 6) {
          if (!candidateRoots.includes(sib)) candidateRoots.push(sib);
          sib = sib.nextElementSibling;
        }
      };
      checkSiblings(targetEl);
      if (targetEl.parentElement) checkSiblings(targetEl.parentElement);
    }

    // ライブDOMから画像を網羅抽出
    const allExtractedImages = [];
    const seenUrlsInTurn = new Set();
    for (const rootEl of candidateRoots) {
      const list = extractLiveImages(rootEl, role);
      for (const itemImg of list) {
        if (!seenUrlsInTurn.has(itemImg.src)) {
          seenUrlsInTurn.add(itemImg.src);
          allExtractedImages.push(itemImg);
        }
      }
    }

    const text = contentNode ? contentNode.textContent.trim() : '';
    if (!text && allExtractedImages.length === 0) return null;

    let clone;
    if (contentNode && contentNode.tagName === 'IMG') {
      clone = document.createElement('div');
      clone.appendChild(sanitizeClone(contentNode));
    } else if (contentNode) {
      clone = sanitizeClone(contentNode);
    } else {
      clone = document.createElement('div');
    }

    // 抽出された画像を clone に確実に追加
    if (allExtractedImages.length > 0) {
      const existingSrcs = new Set(
        [...clone.querySelectorAll('img')].map(getImageSourceUrl).filter(Boolean)
      );
      for (const ext of allExtractedImages) {
        const s = ext.base64 || ext.src;
        if (s) {
          // すでにclone内に同じ画像が存在する場合はBase64に差し替えて完了
          let alreadyInClone = false;
          clone.querySelectorAll('img').forEach((img) => {
            const cur = getImageSourceUrl(img);
            if (cur === s || cur === ext.src) {
              alreadyInClone = true;
              if (ext.base64) img.setAttribute('src', ext.base64);
            }
          });

          if (!alreadyInClone && !existingSrcs.has(s) && !existingSrcs.has(ext.src)) {
            existingSrcs.add(s);
            const imgEl = ext.el.cloneNode(true);
            imgEl.setAttribute('src', s);
            imgEl.setAttribute('loading', 'eager');
            imgEl.setAttribute('referrerpolicy', 'no-referrer');
            imgEl.removeAttribute('srcset');
            imgEl.style.maxWidth = '100%';
            imgEl.style.height = 'auto';
            imgEl.style.borderRadius = '8px';
            imgEl.style.display = 'block';
            imgEl.style.margin = '10px 0';

            if (role === 'user') {
              // ユーザー発言の場合、添付画像は質問文の前に配置（チャットUIの表示順序と一致）
              clone.prepend(imgEl);
            } else {
              clone.appendChild(imgEl);
            }
          }
        }
      }
    }

    const imgKey = allExtractedImages.length > 0 ? (allExtractedImages[0].src || '').slice(-30) : '';
    const htmlContent = clone.innerHTML.trim() || (clone.tagName === 'IMG' ? clone.outerHTML : '');
    return {
      key: hashKey(role + '|' + text.slice(0, 300) + '|' + imgKey),
      role,
      html: htmlContent
    };
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
            const msg = processMessageItem(sub, subRole, cfg, item);
            if (msg) results.push(msg);
          }
          continue;
        }
        role = userEl && !matchAny(userEl, cfg.assistantMatch) ? 'user' : 'assistant';
      }
      if (!role) {
        // 判定できない場合はスキップ(ヘッダ等の誤検出防止)
        continue;
      }
      const msg = processMessageItem(item, role, cfg, null);
      if (msg) results.push(msg);
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
    const toolSels = '[class*="thinking"], [class*="reasoning"], [class*="source-card"], [class*="search-result"], [class*="copilot-step"], [class*="ds-think"], .ds-think';
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
        const userMsg = processMessageItem(userEl, 'user', cfg, null);
        if (userMsg && userMsg.key !== lastUserKey) {
          results.push(userMsg);
          lastUserKey = userMsg.key;
        }
      }
      const aiMsg = processMessageItem(aiEl, 'assistant', cfg, null);
      if (aiMsg) {
        results.push(aiMsg);
      }
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
      const options = (url.startsWith('blob:') || url.startsWith('data:')) ? {} : { cache: 'force-cache' };
      const res = await fetch(url, options);
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
   * Image オブジェクト + Canvas 描画で Data URL に変換
   */
  async function imageObjectToDataUrl(url) {
    try {
      return await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const dataUrl = imageToDataUrlViaCanvas(img);
            resolve(dataUrl);
          } catch (_) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
        setTimeout(() => resolve(null), 3000);
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

    // キャッシュをチェック
    if (IMAGE_BASE64_CACHE.has(rawSrc)) return IMAGE_BASE64_CACHE.get(rawSrc);
    if (IMAGE_BASE64_CACHE.has(absUrl)) return IMAGE_BASE64_CACHE.get(absUrl);

    // 既にBase64の場合
    if (absUrl.startsWith('data:image/')) {
      if (absUrl.length < 500000) {
        IMAGE_BASE64_CACHE.set(absUrl, absUrl);
        return absUrl;
      }
    }

    // liveImgの探索補完 (LIVE_ELEMENT_IMAGE_MAPも確認)
    if (!liveImg) {
      liveImg = LIVE_ELEMENT_IMAGE_MAP.get(rawSrc) || LIVE_ELEMENT_IMAGE_MAP.get(absUrl) || null;
    }

    // 1) ライブDOMのimg要素から直接Canvas描画を試行
    if (liveImg) {
      if (liveImg.complete && (liveImg.naturalWidth > 0 || liveImg.width > 0)) {
        const dataUrl = imageToDataUrlViaCanvas(liveImg);
        if (dataUrl) {
          IMAGE_BASE64_CACHE.set(rawSrc, dataUrl);
          IMAGE_BASE64_CACHE.set(absUrl, dataUrl);
          return dataUrl;
        }
      } else {
        // 画像読み込み完了を少し待機
        await new Promise((resolve) => {
          const done = () => resolve();
          liveImg.addEventListener('load', done, { once: true });
          liveImg.addEventListener('error', done, { once: true });
          setTimeout(done, 1500);
        });
        if (liveImg.naturalWidth > 0 || liveImg.width > 0) {
          const dataUrl = imageToDataUrlViaCanvas(liveImg);
          if (dataUrl) {
            IMAGE_BASE64_CACHE.set(rawSrc, dataUrl);
            IMAGE_BASE64_CACHE.set(absUrl, dataUrl);
            return dataUrl;
          }
        }
      }
    }

    // 2) fetch による Blob 取得 (blob: URL や same-origin / CORS対応画像)
    const fetchedDataUrl = await fetchBlobToDataUrl(absUrl);
    if (fetchedDataUrl) {
      try {
        const optimized = await imageObjectToDataUrl(fetchedDataUrl);
        const result = optimized || fetchedDataUrl;
        IMAGE_BASE64_CACHE.set(rawSrc, result);
        IMAGE_BASE64_CACHE.set(absUrl, result);
        return result;
      } catch (_) {
        IMAGE_BASE64_CACHE.set(rawSrc, fetchedDataUrl);
        IMAGE_BASE64_CACHE.set(absUrl, fetchedDataUrl);
        return fetchedDataUrl;
      }
    }

    // 3) Image オブジェクト + Canvas 描画試行 (blob: URL 等の追加フォールバック)
    const imgObjUrl = await imageObjectToDataUrl(absUrl);
    if (imgObjUrl) {
      IMAGE_BASE64_CACHE.set(rawSrc, imgObjUrl);
      IMAGE_BASE64_CACHE.set(absUrl, imgObjUrl);
      return imgObjUrl;
    }

    // 4) Background Service Worker (拡張機能権限・host_permissions) 経由での取得 (※ blob: は別コンテキストのため渡さない)
    if (!absUrl.startsWith('blob:') && !absUrl.startsWith('data:')) {
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
          if (bgResult) {
            IMAGE_BASE64_CACHE.set(rawSrc, bgResult);
            IMAGE_BASE64_CACHE.set(absUrl, bgResult);
            return bgResult;
          }
        }
      } catch (_) {}
    }

    // 5) blob: URL が変換できなかった場合、export.html側では無効になるため、null を返す
    if (absUrl.startsWith('blob:')) {
      return null;
    }

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

    // 変換結果キャッシュ (全体共有キャッシュを利用)
    const cache = IMAGE_BASE64_CACHE;

    for (const m of messages) {
      if (!m.html || !m.html.includes('<img')) continue;

      const tpl = document.createElement('div');
      tpl.innerHTML = m.html;
      const imgs = [...tpl.querySelectorAll('img')];
      let modified = false;

      for (const img of imgs) {
        const src = getImageSourceUrl(img) || img.getAttribute('src');
        if (!src) continue;

        let base64 = cache.get(src) || (img.src && cache.get(img.src)) || null;
        if (!base64) {
          const liveImg = pageImgsBySrc.get(src) ||
            LIVE_ELEMENT_IMAGE_MAP.get(src) ||
            pageImgsBySrc.get(img.getAttribute('src')) ||
            pageImgsBySrc.get(img.src) ||
            LIVE_ELEMENT_IMAGE_MAP.get(img.getAttribute('src')) ||
            LIVE_ELEMENT_IMAGE_MAP.get(img.src);
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
  // Gemini Notebook (NotebookLM) 専用ソース抽出
  // ---------------------------------------------------------------
  function unwrapGoogleRedirectUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      if ((u.hostname === 'www.google.com' || u.hostname === 'google.com') && u.pathname === '/url') {
        const target = u.searchParams.get('q') || u.searchParams.get('url');
        if (target && /^https?:\/\//i.test(target)) {
          return target;
        }
      }
    } catch (_) {}
    return rawUrl;
  }

  async function extractGeminiNotebookSources() {
    const sources = [];
    const seenTitles = new Set();

    const ICON_LIGATURES_REGEX = /^(attach_file|article|spark|video_youtube|drive_pdf|description|image|photo|check_box|more_vert|keyboard_arrow_down|keyboard_arrow_right|arrow_drop_down|arrow_drop_up|expand_more|expand_less|chevron_right|chevron_left|label_auto|open_in_new|sticky_note_2|picture_as_pdf|public|language|link|collapse_content|dock_to_right|dock_to_left|arrow_back|close|note|auto_awesome|button_magic|folder|folder_open|chevron_down)+$/i;
    const PREFIX_LIGATURE_REGEX = /^(attach_file|article|spark|video_youtube|drive_pdf|description|image|photo|check_box|more_vert|keyboard_arrow_down|keyboard_arrow_right|arrow_drop_down|expand_more|expand_less|chevron_right|label_auto|open_in_new|sticky_note_2|picture_as_pdf|public|language|link|folder|folder_open)\s*/gi;
    const SUFFIX_LIGATURE_REGEX = /\s*(more_vert|open_in_new|keyboard_arrow_down|keyboard_arrow_right|arrow_drop_up|arrow_drop_down)$/gi;
    const CATEGORY_NAMES_REGEX = /^(テスト・問題集|メモ|画像ファイル|熱力学・物理法則|物理と数学|すべて選択|Select all|ソースを追加|Add source|検索|Search|ウェブで新しいソース.*|ソース)$/i;

    function sendSourceProgress(statusText) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'AI2PDF_PROGRESS', statusText });
        }
      } catch (_) {}
    }

    // Shadow DOM (notebooklm-source-plus 等) を貫通してクエリを実行
    function querySelectorAllDeep(selector, root = document) {
      const results = [];
      const visited = new Set();
      function walk(node) {
        if (!node || visited.has(node)) return;
        visited.add(node);
        if (node.querySelectorAll) {
          try {
            const matched = node.querySelectorAll(selector);
            for (const m of matched) results.push(m);
          } catch (_) {}
          try {
            const all = node.querySelectorAll('*');
            for (const el of all) {
              if (el.shadowRoot) {
                walk(el.shadowRoot);
              }
            }
          } catch (_) {}
        }
      }
      walk(root);
      return results;
    }

    // ---------------------------------------------------------------
    // Part A: NotebookLM 内部 batchexecute RPC による高速・精密抽出
    // ---------------------------------------------------------------
    async function getNotebookAuthTokens() {
      let csrf = '';
      let sid = '';
      let bl = '';

      const parseHtmlTokens = (txt) => {
        if (!txt) return;
        if (!csrf) {
          const m = txt.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
          if (m) csrf = m[1];
        }
        if (!sid) {
          const m = txt.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
          if (m) sid = m[1];
        }
        if (!bl) {
          const m = txt.match(/"cfb2h"\s*:\s*"([^"]+)"/);
          if (m) bl = m[1];
        }
      };

      try {
        for (const s of document.scripts) {
          parseHtmlTokens(s.textContent);
          if (csrf && sid && bl) break;
        }
      } catch (_) {}

      if (!csrf) {
        try {
          const html = await fetch(location.href, { credentials: 'include' }).then((r) => r.text());
          parseHtmlTokens(html);
        } catch (_) {}
      }

      return { csrf, sid, bl };
    }

    function parseBatchExecuteResponse(rawText, rpcId) {
      if (!rawText) return null;
      const cleaned = rawText.replace(/^\)\]\}'\s*\n?/, '');
      const lines = cleaned.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('[')) continue;
        try {
          const outer = JSON.parse(trimmed);
          if (!Array.isArray(outer)) continue;
          for (const item of outer) {
            if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcId && typeof item[2] === 'string') {
              return JSON.parse(item[2]);
            }
          }
        } catch (_) {}
      }
      return null;
    }

    async function callNotebookRpc(rpcId, rpcParams, tokens) {
      if (!tokens || !tokens.csrf) return null;
      const url = new URL(`${location.origin}/_/LabsTailwindUi/data/batchexecute`);
      url.searchParams.set('rpcids', rpcId);
      url.searchParams.set('source-path', location.pathname);
      if (tokens.bl) url.searchParams.set('bl', tokens.bl);
      if (tokens.sid) url.searchParams.set('f.sid', tokens.sid);
      url.searchParams.set('rt', 'c');
      url.searchParams.set('_reqid', String(Math.floor(100000 + Math.random() * 899999)));

      const fReq = JSON.stringify([[[rpcId, JSON.stringify(rpcParams), null, 'generic']]]);
      const body = new URLSearchParams({
        'f.req': fReq,
        at: tokens.csrf
      });

      const res = await fetch(url.toString(), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body
      });
      if (!res.ok) return null;
      const txt = await res.text();
      return parseBatchExecuteResponse(txt, rpcId);
    }

    function collectUrlsFromAny(node, outUrls = []) {
      if (!node) return outUrls;
      if (typeof node === 'string') {
        if (/^https?:\/\/\S+$/i.test(node.trim())) {
          outUrls.push(unwrapGoogleRedirectUrl(node.trim()));
        }
        return outUrls;
      }
      if (Array.isArray(node)) {
        for (const item of node) collectUrlsFromAny(item, outUrls);
      }
      return outUrls;
    }

    function isUsefulExternalUrl(u) {
      if (!u || !/^https?:\/\//i.test(u)) return false;
      const lower = u.toLowerCase();
      if (
        lower.includes('notebooklm.google.com') ||
        lower.includes('googleusercontent.com') ||
        lower.includes('ggpht.com') ||
        lower.includes('gstatic.com') ||
        lower.includes('w3.org') ||
        lower.includes('schema.org') ||
        lower.includes('accounts.google.com')
      ) {
        return false;
      }
      return true;
    }

    function pickBestImageUrl(urls) {
      for (const u of urls) {
        const l = u.toLowerCase();
        if (
          (l.includes('googleusercontent.com') || l.includes('ggpht.com')) &&
          !l.includes('avatar') && !l.includes('profile') && !l.includes('favicon')
        ) {
          const upgraded = /=([swh]\d+)/i.test(u)
            ? u.replace(/=([swh]\d+)(-[a-z0-9_-]+)*(?=[?#]|$)/i, '=s0')
            : u;
          return { imageUrl: upgraded, fallbackImageUrl: u };
        }
      }
      return { imageUrl: '', fallbackImageUrl: '' };
    }

    function extractTextFromHizoJc(srcData) {
      if (!Array.isArray(srcData)) return '';
      // srcData[0] は通常メタデータ、srcData[3] (または srcData[2]/srcData[1]) が本文ブロックツリー
      const candidates = [
        Array.isArray(srcData[3]) ? srcData[3] : null,
        Array.isArray(srcData[2]) ? srcData[2] : null,
        Array.isArray(srcData[1]) ? srcData[1] : null,
        srcData.length > 1 ? srcData.slice(1) : null
      ].filter(Boolean);

      for (const candidate of candidates) {
        const chunks = [];
        const seen = new Set();

        const walkBlocks = (node) => {
          if (node === null || node === undefined) return;
          if (typeof node === 'string') {
            const s = node.trim();
            if (!s) return;
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return;
            if (/^https?:\/\/\S+$/i.test(s)) return;
            if (/^(image|application|text|video|audio)\/[a-z0-9.+_-]+$/i.test(s)) return;
            if (/^(ja|en|und|zh|ko|fr|de|es)$/i.test(s)) return;
            if (s.length > 12 && seen.has(s)) return;
            if (s.length > 12) seen.add(s);
            chunks.push(s);
            return;
          }
          if (Array.isArray(node)) {
            // GoogleリッチテキストASTブロック: [startOffset, endOffset, content, ...]
            if (node.length >= 3 && typeof node[0] === 'number' && typeof node[1] === 'number') {
              walkBlocks(node[2]);
              return;
            }
            for (const el of node) walkBlocks(el);
          }
        };

        walkBlocks(candidate);
        if (chunks.length > 0) {
          return chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        }
      }
      return '';
    }

    function extractGuideFromTr032e(guideData) {
      if (!Array.isArray(guideData)) return '';
      const parts = [];
      function walk(n) {
        if (!n) return;
        if (typeof n === 'string') {
          const s = n.trim();
          if (s && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) && !/^https?:\/\//i.test(s)) {
            parts.push(s);
          }
        } else if (Array.isArray(n)) {
          for (const item of n) walk(item);
        }
      }
      walk(guideData);
      if (parts.length === 0) return '';
      const summary = parts[0];
      const topics = parts.slice(1).filter((t) => t !== summary && t.length < 60);
      return topics.length > 0 ? `${summary}\n\nトピック: ${topics.join(' / ')}` : summary;
    }

    async function fetchSourcesViaRpc() {
      const nbMatch = location.pathname.match(/\/notebook\/([^/?#]+)/);
      if (!nbMatch) return null;
      const notebookId = nbMatch[1];
      const tokens = await getNotebookAuthTokens();
      if (!tokens.csrf) return null;

      sendSourceProgress('NotebookLM APIからソース一覧を取得中…');
      const nbData = await callNotebookRpc('rLM1Ne', [notebookId, null, [2], null, 0], tokens);
      if (!Array.isArray(nbData)) return null;

      // nbData[0][1] がソース配列（念のため構造探索フォールバックあり）
      let rawSources = (Array.isArray(nbData[0]) && Array.isArray(nbData[0][1])) ? nbData[0][1] : null;
      if (!rawSources) {
        for (const item of nbData) {
          if (Array.isArray(item) && item.length > 0 && Array.isArray(item[0]) && typeof item[0][1] === 'string') {
            rawSources = item;
            break;
          }
        }
      }
      if (!Array.isArray(rawSources) || rawSources.length === 0) return null;

      const parsedList = [];
      for (const entry of rawSources) {
        if (!Array.isArray(entry)) continue;
        const sourceId = Array.isArray(entry[0]) ? entry[0][0] : entry[0];
        const title = (typeof entry[1] === 'string' && entry[1].trim()) ? entry[1].trim() : '';
        if (!sourceId || typeof sourceId !== 'string' || !title) continue;

        const allUrls = collectUrlsFromAny(entry);
        const extUrl = allUrls.find(isUsefulExternalUrl) || (/^https?:\/\//i.test(title) ? title : '');
        const imgPair = pickBestImageUrl(allUrls);

        const titleLower = title.toLowerCase();
        const urlLower = extUrl.toLowerCase();
        const hasImageExt = /\.(png|jpe?g|webp|gif|bmp|svg|tiff|heic)$/i.test(titleLower) ||
          titleLower.startsWith('image1000') ||
          /^\d{7,}\.(jpg|png|jpeg)$/i.test(titleLower);
        const isPdf = !hasImageExt && (
          titleLower.endsWith('.pdf') ||
          urlLower.includes('.pdf') ||
          (urlLower.includes('drive.google.com') && !urlLower.includes('spreadsheets') && !urlLower.includes('presentation'))
        );
        const isYoutube = !hasImageExt && !isPdf && (urlLower.includes('youtube.com') || urlLower.includes('youtu.be'));
        const isNote = !hasImageExt && !isPdf && !isYoutube && (title.includes('メモ') || titleLower.includes('note'));
        const isWeb = !hasImageExt && !isPdf && !isYoutube && !isNote && Boolean(extUrl);

        let type = 'document';
        if (hasImageExt) type = 'image';
        else if (isPdf) type = 'pdf';
        else if (isYoutube) type = 'youtube';
        else if (isWeb) type = 'web';
        else if (isNote) type = 'note';

        parsedList.push({
          sourceId,
          title,
          type,
          url: extUrl,
          imageUrl: imgPair.imageUrl,
          fallbackImageUrl: imgPair.fallbackImageUrl,
          text: '',
          guide: ''
        });
      }

      if (parsedList.length === 0) return null;

      // 各ソースの本文 (hizoJc) とソースガイド (tr032e) を並列バッチ取得
      const BATCH_SIZE = 5;
      for (let i = 0; i < parsedList.length; i += BATCH_SIZE) {
        const batch = parsedList.slice(i, i + BATCH_SIZE);
        sendSourceProgress(`ソース本文・メタデータを取得中 (${Math.min(i + BATCH_SIZE, parsedList.length)}/${parsedList.length})…`);
        await Promise.all(batch.map(async (item) => {
          try {
            const [srcRes, guideResPrimary] = await Promise.all([
              callNotebookRpc('hizoJc', [[item.sourceId], [2], [2]], tokens).catch(() => null),
              callNotebookRpc('tr032e', [[[[item.sourceId]]]], tokens).catch(() => null)
            ]);
            let guideRes = guideResPrimary;
            if (!guideRes) {
              guideRes = await callNotebookRpc('tr032e', [[[item.sourceId]]], tokens).catch(() => null);
            }
            if (srcRes) {
              const extraUrls = collectUrlsFromAny(srcRes);
              if (!item.url) {
                const foundExt = extraUrls.find(isUsefulExternalUrl);
                if (foundExt) item.url = foundExt;
              }
              if (!item.imageUrl) {
                const imgPair = pickBestImageUrl(extraUrls);
                if (imgPair.imageUrl) {
                  item.imageUrl = imgPair.imageUrl;
                  item.fallbackImageUrl = imgPair.fallbackImageUrl;
                }
              }
              const txt = extractTextFromHizoJc(srcRes);
              if (txt) item.text = txt;
            }
            if (guideRes) {
              const g = extractGuideFromTr032e(guideRes);
              if (g) item.guide = g;
            }
          } catch (e) {
            console.warn('[AI2PDF] RPC item warning:', item.title, e);
          }
        }));
      }

      // メモ (Studio Notes) も RPC (cFji9) で取得を試行
      try {
        const notesRes = await callNotebookRpc('cFji9', [notebookId], tokens);
        if (Array.isArray(notesRes) && Array.isArray(notesRes[0])) {
          for (const nEntry of notesRes[0]) {
            if (!Array.isArray(nEntry)) continue;
            const nMeta = Array.isArray(nEntry[1]) ? nEntry[1] : nEntry;
            const nText = typeof nMeta[1] === 'string' ? nMeta[1].trim() : '';
            const nTitle = typeof nMeta[4] === 'string' && nMeta[4].trim() ? nMeta[4].trim() : '保存済みメモ';
            if (nText && !parsedList.some((p) => p.title === nTitle && p.text === nText)) {
              parsedList.push({
                sourceId: nEntry[0] || `note-${parsedList.length + 1}`,
                title: nTitle,
                type: 'note',
                url: '',
                imageUrl: '',
                fallbackImageUrl: '',
                text: nText,
                guide: 'NotebookLM メモ / ノート'
              });
            }
          }
        }
      } catch (_) {}

      return parsedList;
    }

    // ---------------------------------------------------------------
    // Part B: Shadow-DOM対応 サイドバー＆ビューア操作ヘルパー
    // ---------------------------------------------------------------
    function getVisibleSidebarCheckboxes() {
      const cbs = querySelectorAllDeep('mat-checkbox, [role="checkbox"], input[type="checkbox"]');
      return cbs.filter((cb) => {
        if (cb.tagName === 'INPUT') {
          const root = cb.getRootNode();
          const parentCb = cb.closest ? cb.closest('mat-checkbox, [role="checkbox"]') : null;
          if (parentCb && parentCb !== cb && root === parentCb.getRootNode()) return false;
        }
        const r = cb.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.left > 580) return false;
        return true;
      });
    }

    function getVisibleSourceContainers() {
      const containers = querySelectorAllDeep('.single-source-container, [class*="single-source"]');
      return containers.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 100 && r.height >= 20 && r.height <= 120 && r.left < 580;
      });
    }

    function isSourceListVisible() {
      return getVisibleSourceContainers().length >= 1 || getVisibleSidebarCheckboxes().length >= 2;
    }

    function findSidebarScroller() {
      const candidates = querySelectorAllDeep(
        'cdk-virtual-scroll-viewport, [class*="sources-list"], [class*="source-list"], [class*="source-panel"], [class*="sources-panel"], mat-selection-list, aside, nav, div'
      );
      let best = null;
      let bestArea = Infinity;
      for (const sc of candidates) {
        const r = sc.getBoundingClientRect();
        if (r.width < 130 || r.width > 580 || r.height < 120 || r.left > 480) continue;
        if (sc.scrollHeight <= sc.clientHeight + 20) continue;
        const style = window.getComputedStyle(sc);
        const oy = (style && style.overflowY) || '';
        const isScrollable = sc.tagName === 'CDK-VIRTUAL-SCROLL-VIEWPORT' || oy === 'auto' || oy === 'scroll' || oy === 'overlay';
        if (!isScrollable) continue;
        const hasItems = querySelectorAllDeep('.single-source-container, mat-checkbox, [role="checkbox"], input[type="checkbox"]', sc).length > 0;
        if (!hasItems) continue;
        const area = r.width * r.height;
        if (area < bestArea) {
          bestArea = area;
          best = sc;
        }
      }
      return best;
    }

    function findOpenSourceViewer() {
      const viewerCandidates = querySelectorAllDeep(
        '[class*="source-viewer"], [class*="source-view"], [class*="source-detail"], [class*="document-viewer"], [role="dialog"], [class*="viewer-container"], labs-source-view, section[class*="source"]'
      );
      for (const vc of viewerCandidates) {
        const r = vc.getBoundingClientRect();
        const txt = vc.textContent || '';
        if (r.width >= 200 && r.height >= 150 && !txt.includes('ソースを追加') && !txt.includes('Add source')) {
          return vc;
        }
      }
      return null;
    }

    async function returnToSourceList() {
      if (isSourceListVisible() && !findOpenSourceViewer()) return true;

      const btns = querySelectorAllDeep('button, [role="button"]').filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left < 620 && r.top < 220;
      });

      const priorityMatchers = [
        (b, txt, lbl) => /戻る|ソース一覧|ソースを閉じる|back|close source/i.test(lbl) || txt === 'arrow_back' || txt === 'close',
        (b, txt, lbl) => txt === 'collapse_content' || txt === 'chevron_left' || /collapse|閉じる/i.test(lbl)
      ];

      for (const matchFn of priorityMatchers) {
        for (const b of btns) {
          const txt = (b.textContent || '').trim().toLowerCase();
          const lbl = (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim();
          if (txt === 'dock_to_right' || /sidebar|パネルを折りたた/i.test(lbl)) continue;
          if (matchFn(b, txt, lbl)) {
            try { b.click(); } catch (_) {}
            const t0 = Date.now();
            while (Date.now() - t0 < 550) {
              await new Promise((r) => setTimeout(r, 60));
              if (isSourceListVisible() && !findOpenSourceViewer()) return true;
            }
          }
        }
      }

      if (!isSourceListVisible()) {
        const expandBtns = querySelectorAllDeep('button, [role="button"]').filter((b) => {
          const r = b.getBoundingClientRect();
          const t = (b.textContent || '').trim().toLowerCase();
          const l = (b.getAttribute('aria-label') || '').toLowerCase();
          return r.width > 0 && r.left < 200 && (t === 'dock_to_left' || t === 'chevron_right' || l.includes('ソース') || l.includes('source'));
        });
        for (const eb of expandBtns) {
          try { eb.click(); } catch (_) {}
          await new Promise((r) => setTimeout(r, 180));
          if (isSourceListVisible()) return true;
        }
      }

      return isSourceListVisible();
    }

    function findSingleRowFromCheckbox(cb, scroller) {
      if (cb.closest) {
        const container = cb.closest('.single-source-container');
        if (container) return container;
      }
      let cur = cb;
      let bestRow = null;
      for (let depth = 0; depth < 7 && cur && cur !== document.body && cur !== scroller; depth++) {
        const parent = cur.parentElement;
        if (!parent || parent === document.body || parent === scroller) break;
        const pRect = parent.getBoundingClientRect();
        const innerCheckboxes = Array.from(parent.querySelectorAll('mat-checkbox, [role="checkbox"], input[type="checkbox"]')).filter((x) => {
          if (x.tagName === 'INPUT') {
            const p = x.closest('mat-checkbox, [role="checkbox"]');
            if (p && p !== x) return false;
          }
          return true;
        });
        if (innerCheckboxes.length > 1) break;
        if (pRect.height > 110) break;
        if (pRect.height >= 22 && pRect.width >= 100) {
          bestRow = parent;
        }
        cur = parent;
      }
      return bestRow;
    }

    function isCategoryOrControlRow(row) {
      if (!row) return true;
      if (row.classList && row.classList.contains('single-source-container')) return false;
      const rawTxt = (row.innerText || row.textContent || '').trim();
      if (!rawTxt) return true;
      if (/^(すべて選択|Select all|ソースを追加|Add source)/i.test(rawTxt)) return true;

      if (row.hasAttribute('aria-expanded') || row.querySelector('[aria-expanded]')) {
        return true;
      }

      const icons = row.querySelectorAll('mat-icon, [class*="material-symbols"], [class*="google-symbols"]');
      for (const ic of icons) {
        const t = (ic.textContent || '').trim().toLowerCase();
        if (
          t === 'keyboard_arrow_down' || t === 'keyboard_arrow_right' ||
          t === 'arrow_drop_down' || t === 'expand_more' ||
          t === 'expand_less' || t === 'chevron_right' || t === 'chevron_down' ||
          t === 'folder' || t === 'folder_open'
        ) {
          return true;
        }
      }
      return false;
    }

    function extractCleanRowTitle(row) {
      if (!row) return '';
      // 1. 専用タイトル要素があれば最優先で取得
      const directTitleEl = row.querySelector('.source-title, .source-title-column, [class*="source-title"]');
      if (directTitleEl) {
        const tip = (directTitleEl.getAttribute('title') || directTitleEl.getAttribute('mattooltip') || '').trim();
        const raw = (directTitleEl.textContent || '').trim().replace(/\s+/g, ' ');
        const picked = (tip && tip.length >= raw.length) ? tip : raw;
        const cleanPicked = picked.replace(PREFIX_LIGATURE_REGEX, '').replace(SUFFIX_LIGATURE_REGEX, '').trim();
        if (cleanPicked && cleanPicked.length >= 2 && !ICON_LIGATURES_REGEX.test(cleanPicked) && !CATEGORY_NAMES_REGEX.test(cleanPicked)) {
          return cleanPicked;
        }
      }

      // 2. tooltip 属性候補
      let fullTooltip = '';
      const tipEls = row.querySelectorAll('[title], [mattooltip]');
      for (const te of tipEls) {
        if (te.closest('mat-checkbox, [role="checkbox"], button')) continue;
        const val = (te.getAttribute('title') || te.getAttribute('mattooltip') || '').trim();
        if (val && val.length >= 2 && !ICON_LIGATURES_REGEX.test(val) && !/もっと見る|more|選択|check/i.test(val)) {
          fullTooltip = val;
          break;
        }
      }

      // 3. クローンから厳密にアイコン・ボタンのみ除去（※ [class*="icon"] のような広すぎるセレクタは使わない）
      const clone = row.cloneNode(true);
      clone.querySelectorAll(
        'mat-checkbox, [role="checkbox"], input, mat-icon, svg, .google-symbols, .material-symbols-outlined, .material-icons, .mdc-checkbox, button[aria-haspopup], button[aria-label*="more" i], button[aria-label*="menu" i], button[aria-label*="その他"], button[aria-label*="オプション"]'
      ).forEach((n) => n.remove());

      const text = (clone.innerText || clone.textContent || '').replace(/\r/g, '\n');
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !ICON_LIGATURES_REGEX.test(l));
      let title = lines[0] || '';
      title = title.replace(/\s+/g, ' ').trim();
      title = title.replace(PREFIX_LIGATURE_REGEX, '').replace(SUFFIX_LIGATURE_REGEX, '').trim();

      if (fullTooltip && (!title || title.endsWith('...') || title.endsWith('…') || fullTooltip.length > title.length)) {
        title = fullTooltip;
      }

      if (!title || title.length < 2 || title.length > 220) return '';
      if (ICON_LIGATURES_REGEX.test(title) || CATEGORY_NAMES_REGEX.test(title)) return '';
      return title;
    }

    async function extractActiveSourceView(expectedTitle = '') {
      let guideCard = null;
      let guideText = '';
      const guideHeaders = querySelectorAllDeep('h1, h2, h3, h4, span, div').filter((el) => {
        if (el.children && el.children.length > 3) return false;
        const t = (el.textContent || '').trim();
        return t === 'ソースガイド' || t.toLowerCase() === 'source guide';
      });

      for (const gh of guideHeaders) {
        const card = gh.closest ? gh.closest('[class*="card"], [class*="guide"], [class*="source-guide"], div') : null;
        if (card && card.textContent.length > 20) {
          guideCard = card;
          const cardClone = card.cloneNode(true);
          cardClone.querySelectorAll('h1, h2, h3, h4, button, [class*="header"], mat-icon, .google-symbols').forEach((h) => h.remove());
          guideText = (cardClone.innerText || cardClone.textContent || '')
            .replace(/^(\s*✦|\s*◆|\s*▼|\s*▲|\s*button_magic|\s*arrow_drop_up|\s*ソースガイド|\s*Source guide)+/gi, '')
            .trim();
          if (guideText) break;
        }
      }

      let viewerEl = findOpenSourceViewer();

      if (!viewerEl && !isSourceListVisible()) {
        const allHeaders = querySelectorAllDeep('h1, h2, h3, h4, span, div');
        for (const h of allHeaders) {
          const t = (h.textContent || '').trim();
          if (t === 'ソース' || t === 'Sources') {
            const hr = h.getBoundingClientRect();
            if (hr.width > 0 && hr.top < 160 && hr.left < 600) {
              let panel = h.parentElement;
              while (panel && panel !== document.body) {
                const pr = panel.getBoundingClientRect();
                const pTxt = panel.textContent || '';
                if (pr.width >= 200 && pr.height >= 200 && pr.width <= 900 && !pTxt.includes('Studio') && !pTxt.includes('チャット')) {
                  viewerEl = panel;
                  if (pr.height >= 350) break;
                }
                panel = panel.parentElement;
              }
              if (viewerEl) break;
            }
          }
        }
      }

      if (!viewerEl && guideCard) {
        let p = guideCard.parentElement;
        while (p && p !== document.body) {
          const pr = p.getBoundingClientRect();
          const pTxt = p.textContent || '';
          if (pr.width >= 200 && pr.width <= 900 && !pTxt.includes('ソースを追加') && !pTxt.includes('Add source')) {
            viewerEl = p;
            if (pr.height >= 350) break;
          }
          p = p.parentElement;
        }
      }

      if (!viewerEl && expectedTitle) {
        const leftImgs = querySelectorAllDeep('img').filter((img) => {
          const r = img.getBoundingClientRect();
          const s = img.currentSrc || img.src || '';
          const ls = s.toLowerCase();
          return r.width >= 80 && r.height >= 80 && r.left < window.innerWidth * 0.7 &&
            !ls.includes('avatar') && !ls.includes('profile') && !ls.includes('logo') && !ls.includes('gstatic.com');
        });
        if (leftImgs.length > 0) {
          let p = leftImgs[0].parentElement;
          while (p && p !== document.body) {
            const pr = p.getBoundingClientRect();
            if (pr.width >= 200 && pr.width <= 900 && pr.height >= 200) {
              viewerEl = p;
              if (pr.height >= 350) break;
            }
            p = p.parentElement;
          }
        }
      }

      if (!viewerEl) return null;

      let title = '';
      const titleSelectors = [
        '[class*="source-view"] [class*="title"]',
        '[class*="source-detail"] [class*="title"]',
        '[class*="viewer-header"] [class*="title"]',
        '[class*="doc-title"]',
        '[class*="source-title"]',
        'h1',
        'h2',
        'h3'
      ];
      for (const sel of titleSelectors) {
        const tEls = querySelectorAllDeep(sel, viewerEl);
        for (const tEl of tEls) {
          if (guideCard && guideCard.contains(tEl)) continue;
          const t = (tEl.getAttribute('title') || tEl.textContent || '').trim()
            .replace(PREFIX_LIGATURE_REGEX, '').replace(SUFFIX_LIGATURE_REGEX, '').trim();
          if (t && t !== 'ソース' && t !== 'Sources' && !t.includes('ソースガイド') && !t.includes('ソースを追加') && t.length < 180) {
            title = t;
            break;
          }
        }
        if (title) break;
      }
      if (!title && expectedTitle) title = expectedTitle;

      let url = '';
      const externalLinkSelectors = [
        'a[target="_blank"][href^="http"]',
        'a[href^="http"]:not([href*="accounts.google.com"]):not([href*="notebooklm.google.com"])',
        '[data-url]',
        '[data-source-url]',
        '[data-href]',
        '[ng-reflect-href]'
      ];
      for (const elSel of externalLinkSelectors) {
        const linkEls = querySelectorAllDeep(elSel, viewerEl);
        for (const linkEl of linkEls) {
          const rawHref = (linkEl.tagName === 'A' ? linkEl.href : '') ||
            linkEl.getAttribute('data-url') ||
            linkEl.getAttribute('data-source-url') ||
            linkEl.getAttribute('data-href') ||
            linkEl.getAttribute('ng-reflect-href') ||
            linkEl.getAttribute('href') || '';
          if (rawHref && /^https?:\/\//i.test(rawHref)) {
            url = unwrapGoogleRedirectUrl(rawHref);
            break;
          }
        }
        if (url) break;
      }
      if (!url && /^https?:\/\//i.test(title)) {
        url = title;
      }

      let bodyText = '';
      const bodySelectors = [
        '[class*="document-content"]',
        '[class*="document-body"]',
        '[class*="article-content"]',
        '[class*="viewer-content"]',
        '[class*="viewer-body"]',
        '[class*="markdown-content"]',
        '[class*="text-content"]'
      ];
      let bodyEl = null;
      for (const sel of bodySelectors) {
        const found = querySelectorAllDeep(sel, viewerEl).find((el) => el !== guideCard && !(el.closest && el.closest('[class*="guide"]')));
        if (found) {
          bodyEl = found;
          break;
        }
      }

      if (bodyEl) {
        const bClone = bodyEl.cloneNode(true);
        bClone.querySelectorAll('button, mat-icon, .google-symbols, .material-symbols-outlined, [class*="guide"]').forEach((n) => n.remove());
        bodyText = (bClone.innerText || bClone.textContent || '').trim();
      } else {
        const clone = viewerEl.cloneNode(true);
        clone.querySelectorAll('button, [class*="header"], [class*="toolbar"], [class*="guide"], [class*="nav"], img, mat-icon, .google-symbols, .material-symbols-outlined, [class*="material-symbols"]').forEach((n) => n.remove());
        bodyText = (clone.innerText || clone.textContent || '').trim();
        if (title && bodyText.startsWith(title)) {
          bodyText = bodyText.slice(title.length).trim();
        }
      }

      if ((bodyText.includes('drive_pdf') && bodyText.includes('video_youtube')) || (bodyText.includes('1000005982.jpg') && bodyText.includes('新しいメモ'))) {
        bodyText = '';
      }

      let type = 'document';
      const checkStr = (title + ' ' + url).toLowerCase();
      const hasImageExt = /\.(png|jpe?g|webp|gif|bmp|svg|tiff|heic)$/i.test(title) || title.toLowerCase().startsWith('image1000');
      const isPdf = title.toLowerCase().endsWith('.pdf') || checkStr.includes('.pdf?') || url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('drive.google.com/file');
      const isYoutube = checkStr.includes('youtube.com') || checkStr.includes('youtu.be');
      const isNote = !hasImageExt && !isPdf && (title.includes('メモ') || title.toLowerCase().includes('note'));
      const isWeb = Boolean(!hasImageExt && !isPdf && !isYoutube && url && /^https?:\/\//i.test(url));

      if (hasImageExt) type = 'image';
      else if (isPdf) type = 'pdf';
      else if (isYoutube) type = 'youtube';
      else if (isWeb) type = 'web';
      else if (isNote) type = 'note';

      let imageUrl = '';
      let fallbackImageUrl = '';
      let fileDataUrl = '';
      let fileType = '';

      function isCandidateContentImg(img, restrictToSourceArea = false) {
        const r = img.getBoundingClientRect();
        const s = img.currentSrc || img.src || img.getAttribute('src') || '';
        const lowerS = s.toLowerCase();
        if (!s) return false;
        if (
          lowerS.includes('avatar') || lowerS.includes('profile') ||
          lowerS.includes('logo') || lowerS.includes('favicon') ||
          lowerS.includes('gstatic.com/images/icons') || lowerS.includes('fonts.gstatic.com') ||
          lowerS.includes('gstatic.com')
        ) {
          return false;
        }
        if (r.width > 0 && r.height > 0 && r.width < 44 && r.height < 44) return false;
        if (restrictToSourceArea) {
          if (r.width === 0 || r.height === 0) return false;
          if (r.left >= window.innerWidth * 0.75) return false;
          if (img.closest && img.closest('[class*="chat"], [class*="message"], [class*="conversation"]')) return false;
        }
        return true;
      }

      function pickLargestContentImg(list) {
        let best = null;
        let bestArea = -1;
        for (const img of list) {
          const r = img.getBoundingClientRect();
          const w = img.naturalWidth || img.width || r.width || 0;
          const h = img.naturalHeight || img.height || r.height || 0;
          const area = w * h;
          const src = img.currentSrc || img.src || img.getAttribute('src') || '';
          const looksLikeContentImg = (w >= 60 && h >= 60) || src.includes('googleusercontent.com') || src.startsWith('blob:') || src.startsWith('data:image/');
          if (looksLikeContentImg && area >= bestArea) {
            bestArea = area;
            best = img;
          }
        }
        return best;
      }

      const viewerImgs = querySelectorAllDeep('img', viewerEl).filter((img) => isCandidateContentImg(img, false));
      let mainImg = pickLargestContentImg(viewerImgs);

      if (!mainImg && type === 'image') {
        const pageImgs = querySelectorAllDeep('img').filter((img) => isCandidateContentImg(img, true));
        mainImg = pickLargestContentImg(pageImgs);
      }

      if (mainImg) {
        const rawSrc = mainImg.currentSrc || mainImg.src || mainImg.getAttribute('src') || '';
        if (rawSrc.startsWith('data:image/')) {
          fileDataUrl = rawSrc;
          const match = rawSrc.match(/^data:([^;]+);/);
          if (match) fileType = match[1];
        } else if (rawSrc.startsWith('blob:')) {
          try {
            const bResp = await fetch(rawSrc);
            const blob = await bResp.blob();
            fileType = blob.type || 'image/jpeg';
            fileDataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch (_) {}
          if (!fileDataUrl && (mainImg.naturalWidth > 0 || mainImg.width > 0)) {
            try {
              const cv = document.createElement('canvas');
              cv.width = mainImg.naturalWidth || mainImg.width;
              cv.height = mainImg.naturalHeight || mainImg.height;
              cv.getContext('2d').drawImage(mainImg, 0, 0);
              fileDataUrl = cv.toDataURL('image/jpeg', 0.96);
              fileType = 'image/jpeg';
            } catch (_) {}
          }
        } else if (/^https?:\/\//i.test(rawSrc)) {
          fallbackImageUrl = rawSrc;
          if (rawSrc.includes('googleusercontent.com') && /=([swh]\d+)/i.test(rawSrc)) {
            imageUrl = rawSrc.replace(/=([swh]\d+)(-[a-z0-9_-]+)*(?=[?#]|$)/i, '=s0');
          } else {
            imageUrl = rawSrc;
          }
        }
      } else if (type === 'image') {
        const canvases = querySelectorAllDeep('canvas', viewerEl).filter((c) => c.width >= 100 && c.height >= 100);
        if (canvases.length > 0) {
          try {
            const cData = canvases[0].toDataURL('image/jpeg', 0.96);
            if (cData && cData.length > 200) {
              fileDataUrl = cData;
              fileType = 'image/jpeg';
            }
          } catch (_) {}
        }
      }

      return {
        title: title || '無題のソース',
        type,
        url,
        imageUrl,
        fallbackImageUrl,
        fileDataUrl,
        fileType: fileType || (type === 'image' ? 'image/jpeg' : (type === 'pdf' ? 'application/pdf' : '')),
        guide: guideText,
        summary: guideText || (type === 'image' ? '画像ソース' : 'Gemini Notebook 登録ソース'),
        text: bodyText
      };
    }

    async function expandCollapsedFolders() {
      try {
        const collapsedHeaders = querySelectorAllDeep(
          'mat-expansion-panel-header[aria-expanded="false"], [aria-expanded="false"], [class*="accordion"][aria-expanded="false"], [class*="folder"][aria-expanded="false"]'
        );
        for (const ch of collapsedHeaders) {
          const r = ch.getBoundingClientRect();
          if (r.width <= 0 || r.left > 540) continue;
          const txt = (ch.textContent || '').trim();
          if (!/すべて選択|Select all/i.test(txt)) {
            try { ch.click(); } catch (_) {}
          }
        }
        const rightArrows = querySelectorAllDeep('mat-icon, [class*="material-symbols"], .google-symbols');
        for (const arrow of rightArrows) {
          const r = arrow.getBoundingClientRect();
          if (r.width <= 0 || r.left > 540) continue;
          const t = (arrow.textContent || '').trim().toLowerCase();
          if (t === 'keyboard_arrow_right' || t === 'chevron_right') {
            const btn = arrow.closest ? arrow.closest('button, [role="button"], mat-expansion-panel-header, [class*="folder"], div') : null;
            if (btn && btn.getAttribute('aria-expanded') !== 'true') {
              try { btn.click(); } catch (_) {}
            }
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      } catch (_) {}
    }

    function getAllVisibleRowElements(scroller) {
      const containerRows = getVisibleSourceContainers();
      if (containerRows.length > 0) return containerRows;

      const cbs = getVisibleSidebarCheckboxes();
      const rows = [];
      const seen = new Set();
      for (const cb of cbs) {
        const row = findSingleRowFromCheckbox(cb, scroller);
        if (!row || seen.has(row) || isCategoryOrControlRow(row)) continue;
        seen.add(row);
        rows.push(row);
      }
      return rows;
    }

    function titlesMatch(rowTitle, targetTitle) {
      if (!rowTitle || !targetTitle) return false;
      if (rowTitle === targetTitle) return true;
      const cleanRow = rowTitle.replace(/(?:\.\.\.|…)+$/g, '').trim();
      const cleanTarget = targetTitle.replace(/(?:\.\.\.|…)+$/g, '').trim();
      if (cleanRow.length >= 4 && cleanTarget.startsWith(cleanRow)) return true;
      if (cleanTarget.length >= 4 && cleanRow.startsWith(cleanTarget)) return true;
      return false;
    }

    function findVisibleRowForItem(item, scroller) {
      const rows = getAllVisibleRowElements(scroller);
      const matches = [];
      for (const row of rows) {
        const t = extractCleanRowTitle(row);
        if (titlesMatch(t, item.title)) {
          matches.push(row);
        }
      }
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        return matches[Math.min(item.occurrenceIdx || 0, matches.length - 1)];
      }
      return null;
    }

    async function openSourceRow(item) {
      await returnToSourceList();

      const scroller = findSidebarScroller();
      let row = (item.el && item.el.isConnected && item.el.getBoundingClientRect().height > 0) ? item.el : null;

      if (!row) {
        row = findVisibleRowForItem(item, scroller);
      }

      if (!row && scroller && scroller.scrollHeight > scroller.clientHeight + 10) {
        scroller.scrollTop = item.approxScrollTop || 0;
        await new Promise((r) => setTimeout(r, 120));
        row = findVisibleRowForItem(item, scroller);

        if (!row) {
          const maxScroll = scroller.scrollHeight;
          const step = Math.max(100, Math.floor(scroller.clientHeight * 0.55));
          for (let pos = 0; pos <= maxScroll + step; pos += step) {
            scroller.scrollTop = Math.min(pos, maxScroll);
            await new Promise((r) => setTimeout(r, 90));
            row = findVisibleRowForItem(item, scroller);
            if (row) break;
          }
        }
      }

      // Shadow DOM (notebooklm-source-plus) が非表示にしているネイティブ行フォールバック
      if (!row) {
        const hiddenNative = querySelectorAllDeep('.single-source-container');
        for (const nr of hiddenNative) {
          const nt = extractCleanRowTitle(nr);
          if (titlesMatch(nt, item.title)) {
            row = nr;
            break;
          }
        }
      }

      if (!row) return false;
      item.el = row;

      try {
        if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      } catch (_) {}

      let clickTarget = row.querySelector('.source-title, .source-title-column, [class*="source-title"]');
      if (!clickTarget) {
        const textCandidates = row.querySelectorAll('[class*="title"], [class*="name"], span, div');
        for (const cand of textCandidates) {
          if (cand.closest('mat-checkbox, [role="checkbox"], button[aria-haspopup], button[aria-label*="more" i], button[aria-label*="その他"]')) continue;
          if (cand.classList && (cand.classList.contains('google-symbols') || cand.classList.contains('material-symbols-outlined'))) continue;
          const ct = (cand.textContent || '').trim();
          if (ct && !ICON_LIGATURES_REGEX.test(ct) && ct.length >= 2) {
            clickTarget = cand;
            break;
          }
        }
      }
      if (!clickTarget) clickTarget = row;

      const opts = { bubbles: true, cancelable: true, composed: true, view: window };
      clickTarget.dispatchEvent(new PointerEvent('pointerdown', opts));
      clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
      clickTarget.dispatchEvent(new PointerEvent('pointerup', opts));
      clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
      clickTarget.click();
      return true;
    }

    async function getNotebookSidebarItems() {
      await returnToSourceList();
      await expandCollapsedFolders();

      const scroller = findSidebarScroller();
      const scrollerRect = scroller ? scroller.getBoundingClientRect() : { top: 0 };
      const discoveredList = [];

      function harvestVisibleRows() {
        const scrollTop = scroller ? scroller.scrollTop : 0;
        const rows = getAllVisibleRowElements(scroller);

        for (const row of rows) {
          const title = extractCleanRowTitle(row);
          if (!title) continue;

          const rRect = row.getBoundingClientRect();
          const approxTop = Math.round((rRect.top - scrollerRect.top + scrollTop) / 14);
          const matchedExisting = discoveredList.find((it) => it.title === title && Math.abs(it.approxBucket - approxTop) <= 2);
          if (matchedExisting) {
            matchedExisting.el = row;
            continue;
          }

          const iconEl = row.querySelector('mat-icon, [class*="material-symbols"], .google-symbols, svg');
          const iconText = (iconEl ? (iconEl.textContent || iconEl.getAttribute('aria-label') || '').trim() : '').toLowerCase();

          let type = 'document';
          const lowerTitle = title.toLowerCase();
          const hasImageExt = /\.(png|jpe?g|webp|gif|bmp|svg|tiff|heic)$/i.test(lowerTitle) || lowerTitle.startsWith('image1000') || /^\d{7,}\.(jpg|png|jpeg)$/i.test(lowerTitle);
          const isPdf = lowerTitle.endsWith('.pdf') || iconText.includes('drive_pdf') || iconText.includes('picture_as_pdf');
          const isNote = !hasImageExt && !isPdf && (lowerTitle.includes('メモ') || lowerTitle.includes('note') || iconText.includes('sticky_note') || iconText.includes('note'));
          const isYoutube = !hasImageExt && !isPdf && (iconText.includes('youtube') || lowerTitle.includes('youtube'));
          const isWeb = !hasImageExt && !isPdf && !isNote && !isYoutube && (iconText.includes('link') || iconText.includes('open_in_new') || iconText.includes('public') || iconText.includes('language') || /^https?:\/\//i.test(title) || lowerTitle.includes('wikipedia'));

          if (hasImageExt || iconText === 'image' || iconText === 'photo') type = 'image';
          else if (isPdf) type = 'pdf';
          else if (isYoutube) type = 'youtube';
          else if (isNote) type = 'note';
          else if (isWeb) type = 'web';

          let directUrl = /^https?:\/\//i.test(title) ? title : '';
          const aEl = row.querySelector('a[href^="http"]');
          if (aEl && aEl.href && !aEl.href.includes('notebooklm.google.com')) {
            directUrl = unwrapGoogleRedirectUrl(aEl.href);
            if (type === 'document') type = 'web';
          }

          const occurrenceIdx = discoveredList.filter((it) => it.title === title).length;
          discoveredList.push({
            el: row,
            title,
            occurrenceIdx,
            approxBucket: approxTop,
            approxScrollTop: Math.max(0, Math.round(rRect.top - scrollerRect.top + scrollTop - 60)),
            type,
            directUrl
          });
        }
      }

      harvestVisibleRows();

      if (scroller && scroller.scrollHeight > scroller.clientHeight + 20) {
        const originalScroll = scroller.scrollTop;
        scroller.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 150));
        harvestVisibleRows();

        const maxScroll = scroller.scrollHeight;
        const step = Math.max(100, Math.floor(scroller.clientHeight * 0.55));
        for (let pos = step; pos <= maxScroll + step; pos += step) {
          scroller.scrollTop = Math.min(pos, maxScroll);
          await new Promise((r) => setTimeout(r, 140));
          harvestVisibleRows();
        }
        scroller.scrollTop = originalScroll;
        await new Promise((r) => setTimeout(r, 120));
      }

      return discoveredList;
    }

    // ---------------------------------------------------------------
    // メイン抽出処理: RPC優先 -> 未取得画像のビューア補完 -> UI全体フォールバック
    // ---------------------------------------------------------------
    const preventAllNavigation = (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a && a.href && /^https?:\/\//i.test(a.href) && !a.href.includes('notebooklm.google.com')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
      }
    };
    window.addEventListener('click', preventAllNavigation, true);

    const originalWindowOpen = window.open;
    window.open = function () {
      return null;
    };

    let banner = null;
    try {
      banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:#ffffff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 10px 25px rgba(0,0,0,0.3);z-index:999999;display:flex;align-items:center;gap:10px;pointer-events:none;transition:all 0.2s ease;font-family:sans-serif;';
      banner.innerHTML = `<span style="font-size:16px;">📦</span> <span>NotebookLM ソースを解析中...</span>`;
      document.body.appendChild(banner);
    } catch (_) {}

    const updateBanner = (msg) => {
      sendSourceProgress(msg);
      if (banner) {
        const span = banner.querySelector('span:last-child');
        if (span) span.textContent = msg;
      }
    };

    try {
      let rpcItems = null;
      try {
        rpcItems = await fetchSourcesViaRpc();
      } catch (rpcErr) {
        console.warn('[AI2PDF] NotebookLM RPC extraction warning:', rpcErr);
      }

      if (rpcItems && rpcItems.length > 0) {
        // RPCで全ソース一覧・本文・URL・ガイドを取得済み。画像URLが未取得の画像ソースのみビューアを開いて画像を取得
        const missingImages = rpcItems.filter((it) => it.type === 'image' && !it.imageUrl && !it.fileDataUrl);
        if (missingImages.length > 0) {
          await expandCollapsedFolders();
          for (let j = 0; j < missingImages.length; j++) {
            const imgItem = missingImages[j];
            updateBanner(`画像ソースの実体を取得中 (${j + 1}/${missingImages.length}): ${imgItem.title.substring(0, 20)}`);
            try {
              const clicked = await openSourceRow(imgItem);
              if (clicked) {
                const startT = Date.now();
                while (Date.now() - startT < 2600) {
                  await new Promise((r) => setTimeout(r, 100));
                  const view = await extractActiveSourceView(imgItem.title);
                  if (view && (view.imageUrl || view.fileDataUrl)) {
                    imgItem.imageUrl = view.imageUrl;
                    imgItem.fallbackImageUrl = view.fallbackImageUrl;
                    imgItem.fileDataUrl = view.fileDataUrl;
                    imgItem.fileType = view.fileType;
                    if (!imgItem.text && view.text) imgItem.text = view.text;
                    if (!imgItem.guide && view.guide) imgItem.guide = view.guide;
                    break;
                  }
                }
              }
            } catch (e) {
              console.warn('[AI2PDF] Missing image viewer warning:', imgItem.title, e);
            }
          }
          await returnToSourceList();
        }

        for (const item of rpcItems) {
          sources.push({
            id: `src-${sources.length + 1}`,
            index: sources.length + 1,
            title: item.title,
            type: item.type,
            url: item.url || '',
            imageUrl: item.imageUrl || '',
            fallbackImageUrl: item.fallbackImageUrl || '',
            fileDataUrl: item.fileDataUrl || '',
            fileType: item.fileType || (item.type === 'image' ? 'image/jpeg' : (item.type === 'pdf' ? 'application/pdf' : '')),
            guide: item.guide || '',
            summary: item.guide || (item.type === 'image' ? '画像ソース' : (item.type === 'pdf' ? 'PDFソース' : 'Gemini Notebook 登録ソース')),
            text: item.text || '',
            isSelected: true,
            citations: []
          });
          seenTitles.add(item.title);
        }
      } else {
        // RPCが使用できない環境向けのShadow-DOM対応UIクリックフォールバック
        updateBanner('NotebookLM ソース一覧をスキャン中…');
        const sidebarItems = await getNotebookSidebarItems();

        for (let i = 0; i < sidebarItems.length; i++) {
          const item = sidebarItems[i];
          let detailData = null;

          updateBanner(`ソースを取得中 (${i + 1}/${sidebarItems.length}): ${(item.title || 'ソース').substring(0, 18)}`);

          try {
            const clicked = await openSourceRow(item);
            if (clicked) {
              const maxWait = item.type === 'image' ? 2400 : 1500;
              const startT = Date.now();
              while (Date.now() - startT < maxWait) {
                await new Promise((r) => setTimeout(r, 90));
                const view = await extractActiveSourceView(item.title);
                if (view) {
                  detailData = view;
                  if (item.type === 'image') {
                    if (view.imageUrl || view.fileDataUrl) break;
                  } else if (
                    (view.text && view.text.length > 20) ||
                    (view.url && Date.now() - startT > 350) ||
                    (Date.now() - startT > 900 && (view.guide || view.text))
                  ) {
                    break;
                  }
                }
              }
            }
          } catch (itemErr) {
            console.warn('[AI2PDF] Item extract warning:', item.title, itemErr);
          }

          const finalTitle = item.title;
          let finalType = item.type;
          if (/\.(jpe?g|png|webp|gif|bmp|svg|tiff|heic)$/i.test(finalTitle) || finalTitle.toLowerCase().startsWith('image1000')) {
            finalType = 'image';
          } else if (finalTitle.toLowerCase().endsWith('.pdf')) {
            finalType = 'pdf';
          }

          const finalUrl = unwrapGoogleRedirectUrl((detailData && detailData.url) ? detailData.url : item.directUrl);
          const finalGuide = (detailData && detailData.guide) ? detailData.guide : '';
          const finalText = (detailData && detailData.text) ? detailData.text : '';
          const finalImageUrl = (detailData && detailData.imageUrl) ? detailData.imageUrl : '';
          const finalFallbackImageUrl = (detailData && detailData.fallbackImageUrl) ? detailData.fallbackImageUrl : '';
          const finalFileDataUrl = (detailData && detailData.fileDataUrl) ? detailData.fileDataUrl : '';

          sources.push({
            id: `src-${sources.length + 1}`,
            index: sources.length + 1,
            title: finalTitle,
            type: finalType,
            url: finalUrl,
            imageUrl: finalImageUrl,
            fallbackImageUrl: finalFallbackImageUrl,
            fileDataUrl: finalFileDataUrl,
            fileType: finalType === 'image' ? ((detailData && detailData.fileType) || 'image/jpeg') : (finalType === 'pdf' ? 'application/pdf' : ''),
            guide: finalGuide,
            summary: finalGuide || (finalType === 'image' ? '画像ソース' : (finalType === 'pdf' ? 'PDFソース' : 'Gemini Notebook 登録ソース')),
            text: finalText,
            isSelected: true,
            citations: []
          });
          seenTitles.add(finalTitle);
        }

        await returnToSourceList();
      }
    } finally {
      if (banner && banner.parentNode) {
        try { banner.parentNode.removeChild(banner); } catch (_) {}
      }
      window.removeEventListener('click', preventAllNavigation, true);
      window.open = originalWindowOpen;
    }

    // 3. スタジオ / 保存済みメモ (Notes) DOM補完収集
    const noteCardSelectors = [
      '[class*="note-card"]',
      '[class*="studio-note"]',
      '[class*="saved-note"]',
      '[class*="note-item"]',
      '[data-note-id]'
    ];
    const noteElements = querySelectorAllDeep(noteCardSelectors.join(', '));
    for (const nel of noteElements) {
      const nTitleEl = nel.querySelector('[class*="note-title"], h3, h4, [class*="title"]');
      const nTitle = nTitleEl ? nTitleEl.textContent.trim() : 'ノートメモ';
      if (seenTitles.has(nTitle)) continue;
      seenTitles.add(nTitle);

      const nBodyEl = nel.querySelector('[class*="note-content"], [class*="content"], [class*="text"], p') || nel;
      const nText = (nBodyEl.innerText || nBodyEl.textContent || '').trim();

      sources.push({
        id: `note-${sources.length + 1}`,
        index: sources.length + 1,
        title: nTitle,
        type: 'note',
        url: '',
        guide: 'NotebookLM メモ / ノート',
        summary: 'NotebookLM メモ / ノート',
        text: nText,
        isSelected: true,
        citations: []
      });
    }

    // 4. チャットメッセージ内の引用バッジ (Citations) の関連付け
    const citationBtns = querySelectorAllDeep(
      'button[class*="citation"], [class*="citation-chip"], [class*="citation-pill"], [class*="citation-marker"], [class*="source-citation"], [data-source-id], [data-source-index], sup button'
    );
    citationBtns.forEach((cbtn) => {
      const cnum = (cbtn.textContent || '').trim().replace(/[\[\]]/g, '');
      const idx = parseInt(cnum, 10);
      const label = cbtn.getAttribute('aria-label') || cbtn.getAttribute('title') || '';
      const quote = label || cbtn.getAttribute('data-quote') || '';

      if (!isNaN(idx) && idx > 0) {
        let matched = sources.find((s) => s.index === idx);
        if (!matched && idx <= sources.length) {
          matched = sources[idx - 1];
        }
        if (matched && quote && !matched.citations.includes(quote)) {
          matched.citations.push(quote);
        }
      }
    });

    return sources;
  }

  // ---------------------------------------------------------------
  // メッセージハンドラ (二重登録防止)
  // ---------------------------------------------------------------
  if (!window.__ai2pdfListenerAttached) {
    window.__ai2pdfListenerAttached = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return false;

      if (msg.type === 'AI2PDF_PING_TAB') {
        sendResponse({ ok: true });
        return false;
      }

      if (msg.type !== 'AI2PDF_EXTRACT') return false;

      (async () => {
        const cfg = detectSite();
        if (!cfg) {
          sendResponse({ ok: false, error: 'UNSUPPORTED_SITE' });
          return;
        }
        try {
          const messages = await collectConversation(cfg, (count) => {
            try {
              chrome.runtime.sendMessage({ type: 'AI2PDF_PROGRESS', count });
            } catch (_) { /* noop */ }
          });
          if (!messages.length) {
            sendResponse({ ok: false, error: 'NO_MESSAGES' });
            return;
          }

          let sources = [];
          if (cfg.id === 'gemini-notebook') {
            try {
              sources = await extractGeminiNotebookSources();
            } catch (srcErr) {
              console.warn('[AI2PDF] Source extraction warning:', srcErr);
            }
          }

          sendResponse({
            ok: true,
            data: {
              site: cfg.id,
              siteName: cfg.name,
              title: getConversationTitle(cfg),
              url: location.href,
              exportedAt: new Date().toISOString(),
              messages,
              sources
            }
          });
        } catch (e) {
          sendResponse({ ok: false, error: 'EXTRACT_FAILED', detail: String(e && e.message || e) });
        }
      })();

      return true; // 非同期応答
    });
  }
})();
