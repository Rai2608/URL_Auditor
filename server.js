'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config -----------------------------------------------------------
const FETCH_TIMEOUT_MS = 8000; // FR2.2
const MAX_BYTES = 2 * 1024 * 1024; // FR2.5 - 2MB cap

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// --- Helpers ------------------------------------------------------------

/**
 * Normalize + validate user input into a safe URL object.
 * Throws a { status, message } style error object on failure.
 */
function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw { httpStatus: 400, error: 'URL is required' };
  }

  let candidate = raw.trim();
  // FR1.3 - add scheme if missing
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate)) {
    candidate = 'https://' + candidate;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (e) {
    throw { httpStatus: 400, error: 'Invalid URL' };
  }

  // FR1.4 - only http/https allowed
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw { httpStatus: 400, error: 'Only http and https URLs are supported' };
  }

  if (!parsed.hostname) {
    throw { httpStatus: 400, error: 'Invalid URL' };
  }

  return parsed;
}

/**
 * Fetch a URL with a timeout and a byte cap on the body we read.
 * Returns { response, bodyText, elapsedMs }.
 */
async function fetchWithLimits(urlString) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const start = Date.now();

  let response;
  try {
    response = await fetch(urlString, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'URL-Audit-Tool/1.0 (+https://example.local)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw { httpStatus: 504, error: 'Request timed out' };
    }
    // Covers DNS failures, connection refused, TLS errors, etc.
    throw { httpStatus: 502, error: 'Could not reach host' };
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - start;

  // Read the body with a byte cap so a huge/streaming response can't
  // exhaust memory. We still want elapsedMs to reflect "time to get data",
  // so measure it around the read too, but keep the original start point.
  let bodyText = '';
  try {
    const reader = response.body ? response.body.getReader() : null;
    if (reader) {
      let received = 0;
      const decoder = new TextDecoder('utf-8');
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        bodyText += decoder.decode(value, { stream: true });
        if (received >= MAX_BYTES) {
          try { await reader.cancel(); } catch (_) { /* ignore */ }
          break;
        }
      }
      bodyText += decoder.decode();
    } else {
      bodyText = await response.text();
    }
  } catch (err) {
    throw { httpStatus: 502, error: 'Failed to read response body' };
  }

  const totalElapsedMs = Date.now() - start;

  return { response, bodyText, elapsedMs: totalElapsedMs };
}

function isHtmlContentType(contentType, bodySample) {
  if (contentType && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
    return true;
  }
  // Fallback sniff if content-type header is missing/generic
  if (!contentType && /<html[\s>]/i.test(bodySample.slice(0, 2000))) {
    return true;
  }
  return false;
}

function computeWordCount(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const text = $('body').text() || '';
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words.length;
}

function buildReport({ url, finalUrl, status, contentType, elapsedMs, html }) {
  const $ = cheerio.load(html);

  const title = ($('title').first().text() || '').trim() || null;

  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() || null;

  const h1Count = $('h1').length;

  const images = $('img');
  const totalImages = images.length;
  let missingAlt = 0;
  images.each((_, el) => {
    const alt = $(el).attr('alt');
    // FR4.7: only truly absent `alt` counts as missing; alt="" is intentional.
    if (alt === undefined) missingAlt += 1;
  });

  const wordCount = computeWordCount(html);

  return {
    url,
    finalUrl,
    status,
    contentType: contentType || null,
    responseTimeMs: elapsedMs,
    title,
    metaDescription,
    h1Count,
    images: { total: totalImages, missingAlt },
    wordCount,
  };
}

// --- Route --------------------------------------------------------------

app.post('/api/audit', async (req, res) => {
  let parsedUrl;
  try {
    parsedUrl = normalizeUrl(req.body && req.body.url);
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ error: err.error || 'Invalid URL' });
  }

  try {
    const { response, bodyText, elapsedMs } = await fetchWithLimits(parsedUrl.toString());
    const contentType = response.headers.get('content-type') || '';

    if (!isHtmlContentType(contentType, bodyText)) {
      return res.status(422).json({
        error: 'URL did not return HTML',
        status: response.status,
        contentType: contentType || null,
      });
    }

    const report = buildReport({
      url: parsedUrl.toString(),
      finalUrl: response.url || parsedUrl.toString(),
      status: response.status,
      contentType,
      elapsedMs,
      html: bodyText,
    });

    return res.status(200).json(report);
  } catch (err) {
    if (err && err.httpStatus) {
      return res.status(err.httpStatus).json({ error: err.error });
    }
    // Unexpected error: log full detail server-side, leak nothing to client.
    console.error('Unexpected audit error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
});

// Catch-all JSON 404 for unknown API routes (keeps API responses JSON-only)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler safety net - guarantees we never crash the process
// or send a non-JSON error for anything that slips through above.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

app.listen(PORT, () => {
  console.log(`URL Auditor running at http://localhost:${PORT}`);
});
