# PRD — URL Audit Tool

## 1. Problem / Goal
Give anyone a single input box where they can paste a URL and instantly get a
clean, structured "page health" report — no login, no setup, no crashes,
even when the URL is broken, slow, or not actually HTML.

## 2. Users
- Developers doing a quick sanity check on a page (SEO basics, broken meta,
  missing alt text) before/after a deploy.
- Non-technical users who just want a fast "what's on this page" summary.

## 3. Scope (v1)

### In scope
- One backend endpoint that audits a single URL on demand (synchronous,
  no queue/DB — this is a stateless utility).
- One frontend page: input + submit + rendered report.
- Metrics captured per audit:
  1. HTTP status code
  2. Response time (ms)
  3. Page `<title>`
  4. Meta description (`<meta name="description">`)
  5. H1 count (`<h1>` elements)
  6. Images missing `alt` text (count + total image count)
  7. Approximate word count of visible body text
- Graceful handling of:
  - Malformed / non-URL input
  - Unreachable hosts (DNS failure, connection refused)
  - Timeouts (slow or hanging servers)
  - Non-HTML responses (images, JSON, PDFs, etc.)
  - Redirect chains (follow them, report the final status)
  - Any unexpected server-side exception (must return a clean JSON error,
    never a raw 500 stack trace or a hung request)

### Out of scope (v1)
- Auth, rate limiting, persistence/history of past audits
- Crawling multiple pages / whole-site audits
- JS-rendered (SPA) content — we audit the raw HTML response, not a
  headless-browser render
- Accessibility/SEO scoring or grading — v1 reports facts, not a score

## 4. User flow
1. User opens the page, sees one input field ("Enter a URL") + "Audit" button.
2. User submits. Button shows a loading state.
3. Backend fetches the URL server-side (avoids CORS issues), parses it,
   returns JSON.
4. Frontend renders the report as a clean card/table.
5. On failure, frontend shows a specific, human-readable error message
   (not a stack trace, not a generic "something went wrong").

## 5. Success criteria
- Valid public HTML page → full, correct report in < request timeout.
- Every failure mode in section 3 returns HTTP 4xx/200 with a structured
  JSON error body — the Node process never crashes and the request never
  hangs indefinitely.
- Frontend never shows a raw JS error or blank screen; always shows either
  a report or a readable error message.

## 6. Non-functional requirements
- Single audit request must resolve (success or failure) within 10 seconds.
- No external state/DB required — must run with `npm install && npm start`.
- Works on desktop and mobile viewport widths.
