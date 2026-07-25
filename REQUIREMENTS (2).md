# Requirements

## Functional requirements

### FR1 — Input
- FR1.1 Frontend accepts a single URL string via a text input.
- FR1.2 Backend re-validates the URL server-side regardless of frontend
  validation (never trust the client).
- FR1.3 URLs without a scheme (e.g. `example.com`) are accepted and treated
  as `https://example.com`.
- FR1.4 Only `http:` and `https:` schemes are allowed (reject `file:`,
  `javascript:`, `ftp:`, etc.) to avoid SSRF-style abuse of the fetch step.

### FR2 — Fetch
- FR2.1 Backend performs the HTTP request server-side.
- FR2.2 Request has a hard timeout (default 8s) after which it aborts and
  returns a timeout error.
- FR2.3 Redirects are followed automatically; the report reflects the
  **final** response's status and content.
- FR2.4 Response time is measured as wall-clock time from request start to
  response headers/body received, in milliseconds.
- FR2.5 A capped number of response bytes are read (default 2MB) to avoid
  memory blow-up on huge/streaming responses.

### FR3 — Content-type handling
- FR3.1 If the response `Content-Type` is not `text/html` (or missing but
  content sniffs as HTML), return a clear "not an HTML page" error that
  still includes the status code and content-type that *was* found.

### FR4 — Parsing / report fields
Given an HTML response, compute and return:
- FR4.1 `status` — numeric HTTP status of final response.
- FR4.2 `responseTimeMs` — integer milliseconds.
- FR4.3 `title` — trimmed text of `<title>`, or `null` if absent.
- FR4.4 `metaDescription` — `content` attribute of
  `<meta name="description">`, or `null` if absent.
- FR4.5 `h1Count` — count of `<h1>` elements anywhere in the document.
- FR4.6 `images.total` — count of `<img>` elements.
- FR4.7 `images.missingAlt` — count of `<img>` with no `alt` attribute, or
  an `alt` attribute that is empty/whitespace-only counted separately is
  out of scope for v1 (empty `alt=""` is valid/intentional per HTML spec
  and is **not** counted as missing).
- FR4.8 `wordCount` — approximate count of whitespace-separated word tokens
  in the visible text of `<body>`, after stripping `<script>`, `<style>`,
  `<noscript>`, and HTML tags/comments.
- FR4.9 `finalUrl` — URL after following redirects (helps user see if they
  got redirected somewhere unexpected).
- FR4.10 `contentType` — raw content-type header value, echoed back.

### FR5 — Error handling (must never throw an unhandled exception)
| Case | Behavior |
|---|---|
| Empty / missing `url` field | `400` `{error: "URL is required"}` |
| Malformed URL / unsupported scheme | `400` `{error: "Invalid URL"}` |
| DNS failure / connection refused | `502` `{error: "Could not reach host"}` |
| Timeout | `504` `{error: "Request timed out"}` |
| Non-HTML content-type | `422` `{error: "URL did not return HTML", contentType, status}` |
| Any other unexpected exception | `500` `{error: "Unexpected server error"}` (generic message; details logged server-side only, never leaked to client) |

All error responses share the shape `{ "error": string, ...optional context }`
and the frontend renders `error` directly — no case should ever reach the
client as an unparsable body or a hung connection.

### FR6 — Frontend
- FR6.1 Single page, single form: URL input + submit button.
- FR6.2 Disable the button and show a loading indicator while the request
  is in flight.
- FR6.3 On success, render: status, response time, title, meta description,
  H1 count, image alt-text summary, word count, final URL.
- FR6.4 On error, render the error message in an obviously-styled error
  state (not mixed in with a success report).
- FR6.5 Pressing Enter in the input submits the form (no page reload).
- FR6.6 No client-side framework required; must work by opening the page
  in a browser with zero build step.

## Non-functional requirements
- NFR1 Node.js backend, no database.
- NFR2 `npm install && npm start` is the only setup needed.
- NFR3 Backend listens on `PORT` env var, default `3000`.
- NFR4 CORS enabled on the API so the static frontend can be served
  separately if desired (also works served from the same origin).
- NFR5 No secrets/API keys required.
- NFR6 Basic responsive CSS; usable at mobile widths (~360px) and desktop.

## API contract

`POST /api/audit`

Request body:
```json
{ "url": "example.com" }
```

Success response `200`:
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

Error response (example, `504`):
```json
{ "error": "Request timed out" }
```

`GET /api/health` → `{ "ok": true }` — simple liveness check.
