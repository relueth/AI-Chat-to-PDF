/**
 * Gemini画像抽出バグ修正の検証テスト
 * - ユーザー添付画像 (query-text の外側 / background-image形式) がPDF用抽出結果に含まれるか
 * - AI回答内の生成画像が含まれるか
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const contentSrc = fs.readFileSync(new URL('../extension/content/content.js', import.meta.url), 'utf-8');

const html = `<!DOCTYPE html><html><head><title>テスト会話 - Gemini</title></head><body>
<main>
  <div class="chat-history">
    <div class="conversation-container">
      <user-query>
        <div class="user-query-container">
          <!-- 添付画像プレビュー: query-text の外側にある (実際のGemini構造を模倣)
               1) background-image (CSSクラス由来ではなくインラインstyleだが、
                  クローン側では寸法が取れず旧コードでは復元されない)
               2) クリックでビューアを開く button 内の img -->
          <div class="file-preview-container">
            <div class="new-image-preview" style="background-image: url('https://lh3.googleusercontent.com/attach123=w120-h160')"></div>
            <button class="image-preview-button" aria-label="画像を開く">
              <img class="preview-image" ng-reflect-src="https://lh3.googleusercontent.com/attach456" alt="uploaded image preview">
            </button>
          </div>
          <span class="user-query-bubble-with-background">
            <div class="query-text gds-body-l"><p class="query-text-line">AIが出してくるこの四角で囲うやつの書き方。htmlとかtexとか</p></div>
          </span>
        </div>
      </user-query>
      <model-response>
        <message-content class="model-response-text">
          <div class="markdown markdown-main-panel">
            <p>画像の四角枠は、<b>LaTeX</b> の <code>\\boxed{}</code> コマンドです。</p>
            <div class="image-container"><img src="https://lh3.googleusercontent.com/generated789" alt="generated diagram"></div>
          </div>
        </message-content>
      </model-response>
    </div>
    <div class="conversation-container">
      <!-- ケース2: 添付プレビューが user-query の「外」(ターンコンテナ直下) にある場合 -->
      <div class="attachment-container">
        <img class="attachment-thumb" src="https://lh3.googleusercontent.com/outside-attach999" alt="attached file">
      </div>
      <user-query>
        <div class="user-query-container">
          <span class="user-query-bubble-with-background">
            <div class="query-text gds-body-l"><p class="query-text-line">この画像の内容を要約して</p></div>
          </span>
        </div>
      </user-query>
      <model-response>
        <message-content class="model-response-text">
          <div class="markdown markdown-main-panel"><p>要約します。この画像はLaTeXの数式を含む文書です。</p></div>
        </message-content>
      </model-response>
    </div>
  </div>
</main>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://gemini.google.com/app/abc123', pretendToBeVisual: true });
const { window } = dom;

// 実ブラウザの振る舞いを忠実に模倣:
// - DOMに接続された要素 → 実寸を返す
// - 切り離されたクローン (cloneNode後) → 0x0 を返す (Chromeの実挙動)
//   ※ 旧コードはクローン側で getBoundingClientRect を呼んでいたため
//     常に 0x0 となり background-image 画像が一切復元されないバグがあった
window.Element.prototype.getBoundingClientRect = function () {
  if (!this.isConnected) {
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
  return { width: 120, height: 160, top: 0, left: 0, right: 120, bottom: 160 };
};

// getComputedStyle も実ブラウザ同様、切り離された要素では空を返す
const origGCS = window.getComputedStyle.bind(window);
window.getComputedStyle = (el, pseudo) => {
  if (el && !el.isConnected) {
    return { backgroundImage: '', overflowY: 'visible' };
  }
  return origGCS(el, pseudo);
};

// chrome API スタブ
let messageListener = null;
window.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => { messageListener = fn; } },
    sendMessage: (msg, cb) => { if (cb) cb(null); },
    lastError: null
  }
};

// fetch スタブ (画像取得は常に失敗させ、URLフォールバック経路を検証)
window.fetch = async () => { throw new Error('network disabled in test'); };

// content.js をwindowコンテキストで実行
const keys = ['document', 'location', 'getComputedStyle', 'Node', 'Image', 'FileReader', 'URL', 'chrome', 'fetch'];
const sandbox = {};
for (const k of keys) sandbox[k] = window[k];
sandbox.window = window;
const fn = new Function(...keys, 'window', contentSrc + '\n');
fn.call(window, ...keys.map((k) => sandbox[k]), window);

if (!messageListener) {
  console.error('FAIL: message listener not registered');
  process.exit(1);
}

const result = await new Promise((resolve) => {
  messageListener({ type: 'AI2PDF_EXTRACT' }, null, resolve);
});

let failures = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failures++;
};

check(result && result.ok, 'extraction succeeded');
const msgs = (result && result.data && result.data.messages) || [];
check(msgs.length >= 4, `extracted ${msgs.length} messages (>=4)`);

const userMsgs = msgs.filter((m) => m.role === 'user');
const aiMsgs = msgs.filter((m) => m.role === 'assistant');
check(userMsgs.length >= 2, 'both user messages present');
check(aiMsgs.length >= 2, 'both assistant messages present');

const userMsg = userMsgs.find((m) => m.html.includes('四角で囲うやつ'));
const userMsg2 = userMsgs.find((m) => m.html.includes('要約して'));
const aiMsg = aiMsgs.find((m) => m.html.includes('boxed'));

check(!!userMsg, 'user message 1 (text) present');
if (userMsg) {
  check(userMsg.html.includes('attach456'), 'user attached <img> inside button included');
  check(userMsg.html.includes('attach123'), 'user attached background-image included');
}
check(!!userMsg2, 'user message 2 (text) present');
if (userMsg2) {
  check(userMsg2.html.includes('outside-attach999'), 'attachment outside user-query (turn-level) included');
}
check(!!aiMsg, 'assistant text preserved');
if (aiMsg) {
  check(aiMsg.html.includes('generated789'), 'assistant generated image included');
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
