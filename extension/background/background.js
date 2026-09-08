// AI Chat to PDF - Background Service Worker
// 拡張機能権限(host_permissions)を利用して、CORS制限のある画像(Google User Content等)を安全にBase64化

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'AI2PDF_FETCH_IMAGE_BASE64') {
    handleFetchImage(message.url, message.maxDim || 1200, message.quality || 0.82)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => {
        console.warn('[AI2PDF BG] Failed to fetch/convert image:', message.url, err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // 非同期レスポンス
  }

  if (message && message.type === 'AI2PDF_PING') {
    sendResponse({ ok: true, pong: true });
    return false;
  }
});

/**
 * 拡張機能コンテキストでURLを取得し、最大幅/高さに最適化したBase64 Data URLに変換
 */
async function handleFetchImage(url, maxDim = 1200, quality = 0.82) {
  if (!url) throw new Error('No URL provided');

  // 既にDataURLの場合
  if (url.startsWith('data:image/')) {
    return url;
  }

  // 拡張機能権限(host_permissions: <all_urls>)でのfetch
  // Google CDN (lh3.googleusercontent.com 等) は Access-Control-Allow-Origin: * を返すため、
  // credentials: 'include' を指定するとブラウザのCORS仕様によりTypeErrorで即時拒絶される。
  // 公開・署名付きURLのため credentials を指定せず安全に取得する。
  let res;
  try {
    res = await fetch(url, { cache: 'force-cache' });
  } catch (_) {
    try {
      res = await fetch(url, { credentials: 'omit' });
    } catch (_) {
      res = await fetch(url);
    }
  }

  if (!res || !res.ok) {
    throw new Error(`HTTP error ${res ? res.status : 'network error'}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const blob = await res.blob();

  // SVG形式はそのままDataURL化
  if (contentType.includes('svg') || url.includes('.svg')) {
    return await blobToDataUrl(blob, 'image/svg+xml');
  }

  // OffscreenCanvas と createImageBitmap を用いたリサイズ・JPEG圧縮
  try {
    if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
      const bitmap = await createImageBitmap(blob);
      let w = bitmap.width;
      let h = bitmap.height;

      if (w > 0 && h > 0) {
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
        }

        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        // 白背景を敷く(透明PNG等の暗転防止)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);

        const compressedBlob = await canvas.convertToBlob({
          type: 'image/jpeg',
          quality: quality
        });

        bitmap.close();
        return await blobToDataUrl(compressedBlob, 'image/jpeg');
      }
    }
  } catch (canvasErr) {
    console.warn('[AI2PDF BG] Canvas resize fallback to raw blob:', canvasErr);
  }

  // Canvasリサイズに失敗した場合は生BlobをBase64化
  return await blobToDataUrl(blob, contentType || 'image/jpeg');
}

/**
 * Blob を Base64 Data URL 文字列に変換
 */
async function blobToDataUrl(blob, mimeType) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const CHUNK_SIZE = 8192;

  // コールスタック制限対策のチャンク分割
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
    binary += String.fromCharCode.apply(null, chunk);
  }

  const base64 = btoa(binary);
  const type = mimeType || blob.type || 'image/jpeg';
  return `data:${type};base64,${base64}`;
}
