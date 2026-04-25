import https from 'node:https';
import http from 'node:http';
import { lookup as dnsLookup } from 'node:dns';
import { log } from './config.js';
import { tryExtractPdf } from './pdf.js';
import { isPrivateIp, resolvePublicAddresses } from './net-safety.js';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_BASE64_LEN = Math.ceil(MAX_SIZE * 4 / 3) + 100;
const MAX_REDIRECTS = 3;
const MIME_OK = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// http/https `lookup` hook: runs in place of the default DNS resolution.
// Rejecting here means the request never opens a socket to the internal
// address, closing the DNS-rebinding gap in the string-based host check.
function safeLookup(hostname, options, callback) {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const addrs = Array.isArray(address) ? address : [{ address, family }];
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        return callback(new Error(`Image URL resolves to private address: ${a.address}`));
      }
    }
    callback(null, address, family);
  });
}

function validateImageUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid image URL'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new Error('Image URL must be http or https');
  if (String(parsed.hostname).toLowerCase() === 'localhost' || isPrivateIp(parsed.hostname))
    throw new Error('Image URL targets a private/internal address');
  return parsed;
}

export function parseDataUrl(url) {
  const clean = url.replace(/\s/g, '');
  const m = clean.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return null;
  if (m[2].length > MAX_BASE64_LEN) throw new Error(`Image data URL exceeds ${MAX_SIZE} byte limit`);
  return { base64_data: m[2], mime_type: m[1].toLowerCase() };
}

// Extract base64 body from a data URL of any mime type. Used for PDF
// payloads which don't match parseDataUrl's image-only regex.
export function parseGenericDataUrl(url) {
  const clean = url.replace(/\s/g, '');
  const m = clean.match(/^data:([a-z0-9][a-z0-9.+/-]+);base64,(.+)$/i);
  if (!m) return null;
  if (m[2].length > MAX_BASE64_LEN) throw new Error(`Data URL exceeds ${MAX_SIZE} byte limit`);
  return { base64_data: m[2], mime_type: m[1].toLowerCase() };
}

export async function assertPublicUrlHost(urlOrHost, lookupFn = dnsLookup) {
  let host = urlOrHost;
  try { host = new URL(urlOrHost).hostname; } catch {}
  return resolvePublicAddresses(host, lookupFn);
}

export function fetchImageUrl(url, timeoutMs = 8000, _depth = 0) {
  if (_depth > MAX_REDIRECTS) return Promise.reject(new Error('Too many image redirects'));
  validateImageUrl(url);

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs, headers: { 'Accept': 'image/*' }, lookup: safeLookup }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchImageUrl(res.headers.location, timeoutMs, _depth + 1).then(
          v => done(resolve, v), e => done(reject, e)
        );
      }
      if (res.statusCode !== 200) {
        res.resume();
        return done(reject, new Error(`Image fetch HTTP ${res.statusCode}`));
      }
      const mime = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!MIME_OK.has(mime)) {
        res.resume();
        return done(reject, new Error(`Unsupported image type: ${mime}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (d) => {
        if (settled) return;
        size += d.length;
        if (size > MAX_SIZE) { res.destroy(); done(reject, new Error(`Image exceeds ${MAX_SIZE} bytes`)); }
        else chunks.push(d);
      });
      res.on('end', () => done(resolve, { base64_data: Buffer.concat(chunks).toString('base64'), mime_type: mime }));
      res.on('error', (e) => done(reject, e));
    });
    req.on('error', (e) => done(reject, e));
    req.on('timeout', () => { req.destroy(); done(reject, new Error('Image fetch timeout')); });
  });
}

export async function extractImages(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return { text: String(contentBlocks ?? ''), images: [] };

  let text = '';
  const images = [];

  for (const block of contentBlocks) {
    if (!block || typeof block === 'string') { text += block || ''; continue; }

    if (block.type === 'text') {
      text += block.text || '';
    } else if (block.type === 'document') {
      const src = block.source || {};
      const mime = (src.media_type || '').toLowerCase();
      if (mime === 'application/pdf' && src.data) {
        const pdf = tryExtractPdf(src.data);
        if (pdf?.text) {
          text += `\n[PDF Document — ${pdf.pageCount} page(s)]\n${pdf.text}\n`;
          log.info(`PDF extracted: ${pdf.pageCount} pages, ${pdf.text.length} chars`);
        } else {
          text += '\n[PDF Document — no extractable text (scanned/image-only PDF)]\n';
        }
      }
    } else if (block.type === 'image') {
      const src = block.source || {};
      const mime = (src.media_type || '').toLowerCase();
      if (mime === 'application/pdf' && src.data) {
        const pdf = tryExtractPdf(src.data);
        if (pdf?.text) {
          text += `\n[PDF Document — ${pdf.pageCount} page(s)]\n${pdf.text}\n`;
        }
        continue;
      }
      try {
        if ((src.type === 'base64' || !src.type) && src.data) {
          if (src.data.length > MAX_BASE64_LEN) { log.warn('Image base64 exceeds size limit, skipping'); continue; }
          images.push({ base64_data: src.data, mime_type: src.media_type || 'image/png' });
        } else if (src.type === 'url' && src.url) {
          images.push(await fetchImageUrl(src.url));
        }
      } catch (e) { log.warn(`Image extraction failed: ${e.message}`); }
    } else if (block.type === 'image_url') {
      const url = block.image_url?.url || '';
      try {
        if (url.startsWith('data:')) {
          // PDF-as-data-URL: let the model "see" it via text extraction
          // rather than treating it as an unsupported image type.
          const lower = url.slice(0, 40).toLowerCase();
          if (lower.startsWith('data:application/pdf')) {
            const g = parseGenericDataUrl(url);
            if (g?.base64_data) {
              const pdf = tryExtractPdf(g.base64_data);
              if (pdf?.text) {
                text += `\n[PDF Document — ${pdf.pageCount} page(s)]\n${pdf.text}\n`;
                log.info(`PDF extracted (image_url data URL): ${pdf.pageCount} pages, ${pdf.text.length} chars`);
              } else {
                text += '\n[PDF Document — no extractable text (scanned/image-only PDF)]\n';
              }
            }
            continue;
          }
          const parsed = parseDataUrl(url);
          if (parsed) images.push(parsed);
        } else if (url.startsWith('https://') || url.startsWith('http://')) {
          images.push(await fetchImageUrl(url));
        }
      } catch (e) { log.warn(`Image fetch failed: ${e.message}`); }
    } else if (block.type === 'file' || block.type === 'input_file') {
      // OpenAI PDF input: { type:'file', file:{ filename, file_data:'data:application/pdf;base64,...' } }
      // or file_id (uploaded via Files API — we can't fetch, so ignore).
      const file = block.file || {};
      const dataUrl = file.file_data || file.url || '';
      if (dataUrl.startsWith('data:application/pdf')) {
        const g = parseGenericDataUrl(dataUrl);
        if (g?.base64_data) {
          const pdf = tryExtractPdf(g.base64_data);
          if (pdf?.text) {
            const label = file.filename ? ` "${file.filename}"` : '';
            text += `\n[PDF Document${label} — ${pdf.pageCount} page(s)]\n${pdf.text}\n`;
            log.info(`PDF extracted (OpenAI file block): ${pdf.pageCount} pages, ${pdf.text.length} chars`);
          } else {
            text += '\n[PDF Document — no extractable text (scanned/image-only PDF)]\n';
          }
        }
      } else if (dataUrl && !file.file_id) {
        log.warn(`Unsupported file block data URL: ${dataUrl.slice(0, 40)}...`);
      } else if (file.file_id) {
        log.warn(`File block references file_id=${file.file_id} — upload API not supported, skipping`);
      }
    }
  }

  return { text, images };
}
