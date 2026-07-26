# URL Auditor

Paste in a URL, get back a JSON (and rendered) page-health report: HTTP
status, response time, `<title>`, meta description, H1 count, images
missing `alt` text, and approximate word count. Built to never crash and
to always return a readable error, even for garbage input, dead hosts,
slow servers, or non-HTML responses.

See [`PRD.md`](./PRD.md) for the product spec and
[`REQUIREMENTS.md`](./REQUIREMENTS.md) for the detailed functional
requirements and API contract.

## Stack
- **Backend:** Node.js + Express, native `fetch`, [`cheerio`](https://cheerio.js.org/)
  for HTML parsing. No database.
- **Frontend:** a single static HTML page (`public/index.html`) — vanilla
  JS, no build step, no framework.

## Requirements
- Node.js >= 18 (native `fetch`/`AbortController`). Tested on Node 22.

## Setup

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a browser.

Optional: set a custom port.

```bash
PORT=8080 npm start
```

For local development with auto-restart on file changes:

```bash
npm run dev
```

## How it works
1. The frontend (`public/index.html`) posts `{ "url": "..." }` to
   `POST /api/audit`.
2. The backend validates and normalizes the URL, fetches it server-side
   (avoids browser CORS restrictions entirely), reads up to 2MB of the
   body with an 8-second timeout, and — if the response is HTML — parses
   it with `cheerio` to compute the report fields.
3. The backend returns a single JSON object; the frontend renders it into
   a report panel, or shows a plain-language error if anything failed.

## API

### `POST /api/audit`

**Request**
```json
{ "url": "example.com" }
```
(`https://` is assumed if no scheme is given.)

**Success — `200`**
```json
{
  "url": "https://example.com",
  "finalUrl": "https://example.com/",
  "status": 200,
  "contentType": "text/html; charset=UTF-8",
  "responseTimeMs": 143,
  "title": "Example Domain",
  "metaDescription": null,
  "h1Count": 1,
  "images": { "total": 0, "missingAlt": 0 },
  "wordCount": 28
}
```

**Failure — shape is always `{ "error": string, ...context }`**

| Scenario | HTTP status |
|---|---|
| Missing/empty `url` | 400 |
| Malformed URL or unsupported scheme (only `http`/`https` allowed) | 400 |
| DNS failure / connection refused | 502 |
| Request timed out (8s) | 504 |
| Response isn't HTML | 422 |
| Anything unexpected | 500 (generic message; details are logged server-side only) |

### `GET /api/health`
Liveness check: `{ "ok": true }`.

## Design notes / trade-offs
- **Redirects are followed automatically**; the report reflects the final
  destination (`finalUrl`), so you can tell if a URL redirected somewhere
  unexpected.
- **`alt=""` is not counted as "missing alt."** An empty `alt` is valid,
  intentional markup (decorative image); only a truly absent `alt`
  attribute counts against the "missing alt text" metric.
- **Word count** strips `<script>`/`<style>`/`<noscript>` and all tags,
  then does a plain whitespace split on the remaining `<body>` text — it's
  an approximation, not a linguistically-aware count.
- **Response body is capped at 2MB** read, to keep memory bounded on huge
  or slow-streaming pages.
- **JS-rendered pages are not executed.** This audits the raw HTML
  response, the same thing `curl` would see — single-page apps that render
  their content client-side will show low word counts / missing titles
  by design.

## Manually verifying the failure modes
```bash
# Invalid URL
curl -X POST localhost:3000/api/audit -H 'Content-Type: application/json' \
  -d '{"url":"not a url!!"}'

# Unreachable host
curl -X POST localhost:3000/api/audit -H 'Content-Type: application/json' \
  -d '{"url":"https://this-domain-should-not-exist-zzzz.com"}'

# Non-HTML response
curl -X POST localhost:3000/api/audit -H 'Content-Type: application/json' \
  -d '{"url":"https://raw.githubusercontent.com/nodejs/node/main/README.md"}'
```

## Project structure
```
url-auditor/
├── PRD.md              # product spec
├── REQUIREMENTS.md     # functional/technical requirements + API contract
├── README.md           # this file
├── package.json
├── server.js           # Express backend + audit logic
└── public/
    └── index.html       # frontend (HTML/CSS/JS, no build step)
```
