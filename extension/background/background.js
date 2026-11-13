// AI Chat to PDF - Background Service Worker
// 拡張機能権限(host_permissions)を利用して、CORS制限のある画像(Google User Content等)を安全にBase64化

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'AI2PDF_FETCH_IMAGE_BASE64') {
    handleFetchImage(message.url, message.maxDim || 1200, message.quality || 0.82, message.fallbackUrl || '')
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => {
        console.warn('[AI2PDF BG] Failed to fetch/convert image:', message.url, err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // 非同期レスポンス
  }

  if (message && message.type === 'AI2PDF_FETCH_SOURCE_FILE') {
    handleFetchSourceFile(message.url)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => {
        console.warn('[AI2PDF BG] Failed to fetch source file:', message.url, err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // 非同期レスポンス
  }

  if (message && message.type === 'AI2PDF_PING') {
    sendResponse({ ok: true, pong: true });
    return false;
  }
});

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

async function fetchWithTimeout(targetUrl, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(targetUrl, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithFallback(targetUrl) {
  let res = null;
  try {
    res = await fetchWithTimeout(targetUrl, { credentials: 'include' });
  } catch (_) {}
  if (!res || !res.ok) {
    try {
      res = await fetchWithTimeout(targetUrl, {});
    } catch (_) {}
  }
  if (!res || !res.ok) {
    try {
      res = await fetchWithTimeout(targetUrl, { credentials: 'omit' });
    } catch (_) {}
  }
  return res;
}

async function hasPdfSignature(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
    let str = '';
    for (let i = 0; i < head.length; i++) {
      str += String.fromCharCode(head[i]);
    }
    return str.includes('%PDF-');
  } catch (_) {
    return false;
  }
}

/**
 * 拡張機能コンテキストで外部ソースファイル(PDF/画像/文書等)を取得しBase64 Data URLに変換
 */
async function handleFetchSourceFile(rawUrl) {
  if (!rawUrl) throw new Error('No URL provided');
  const url = unwrapGoogleRedirectUrl(rawUrl);

  const candidates = [];
  const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/);

  if (driveIdMatch && (url.includes('drive.google.com') || url.includes('docs.google.com'))) {
    const id = driveIdMatch[1];
    if (url.includes('docs.google.com/document/')) {
      candidates.push(`https://docs.google.com/document/d/${id}/export?format=pdf`);
    } else if (url.includes('docs.google.com/presentation/')) {
      candidates.push(`https://docs.google.com/presentation/d/${id}/export/pdf`);
    } else if (url.includes('docs.google.com/spreadsheets/')) {
      candidates.push(`https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`);
    }
    candidates.push(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    candidates.push(`https://drive.google.com/uc?export=download&confirm=t&id=${id}`);
  } else {
    candidates.push(url);
  }

  for (const fetchUrl of candidates) {
    const res = await fetchWithFallback(fetchUrl);
    if (!res || !res.ok) continue;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const blob = await res.blob();
    if (!blob || blob.size === 0) continue;

    const isPdf = await hasPdfSignature(blob);
    // HTMLログイン画面やウイルススキャン警告画面をPDFとして誤保存しない
    if (contentType.includes('text/html') && !isPdf) {
      continue;
    }

    const finalMime = isPdf ? 'application/pdf' : (contentType || blob.type || 'application/octet-stream');
    const dataUrl = await blobToDataUrl(blob, finalMime);
    return {
      dataUrl,
      contentType: finalMime,
      size: blob.size,
      isPdf
    };
  }

  throw new Error('Could not fetch valid binary file (HTML or network error)');
}

/**
 * 拡張機能コンテキストでURLを取得し、最大幅/高さに最適化したBase64 Data URLに変換
 */
async function handleFetchImage(url, maxDim = 1200, quality = 0.82, fallbackUrl = '') {
  if (!url) throw new Error('No URL provided');

  // 既にDataURLの場合
  if (url.startsWith('data:image/')) {
    return url;
  }

  const urlsToTry = [unwrapGoogleRedirectUrl(url)];
  if (fallbackUrl && fallbackUrl !== url) {
    urlsToTry.push(unwrapGoogleRedirectUrl(fallbackUrl));
  }

  let blob = null;
  let contentType = '';
  let usedUrl = urlsToTry[0];

  for (const targetUrl of urlsToTry) {
    const res = await fetchWithFallback(targetUrl);
    if (!res || !res.ok) continue;

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const b = await res.blob();
    if (!b || b.size === 0) continue;
    if (ct.includes('text/html') || ct.includes('application/json')) continue;

    blob = b;
    contentType = ct || (b.type || '').toLowerCase();
    usedUrl = targetUrl;
    break;
  }

  if (!blob) {
    throw new Error('Failed to fetch valid image binary');
  }

  // SVG形式または高解像度指定（maxDim >= 2400）の場合は再エンコードせず完全なオリジナルバイナリを保持
  if (contentType.includes('svg') || usedUrl.includes('.svg') || (maxDim >= 2400 && blob.size > 0)) {
    const finalMime = (contentType && contentType.startsWith('image/')) ? contentType : (blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg');
    return await blobToDataUrl(blob, finalMime);
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
