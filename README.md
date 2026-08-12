# Vision API — React hooks

Official React hooks for [Vision API](https://visionapi.io) — let a user pick an image or a
PDF and get structured JSON back with a confidence level on every value.

[![npm](https://img.shields.io/npm/v/@devrobotlabs/visionapi-react.svg)](https://www.npmjs.com/package/@devrobotlabs/visionapi-react)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

- **Website** — <https://visionapi.io>
- **Documentation** — <https://docs.visionapi.io>
- **API keys** — <https://app.visionapi.io/dashboard/keys>
- **Preset catalog** — <https://visionapi.io/presets>
- **Playground** — <https://visionapi.io/playground>
- **Support** — <https://support.visionapi.io> · <https://visionapi.io/contact-us>

---

## Read this first: where the key lives

**There is no publishable key and no test mode.** A Vision API key is a live spending
credential — anyone who reads it out of your bundle can spend your credits. So these hooks
do **not** talk to `api.visionapi.io`. They talk to **your** endpoint, which holds the key
and calls the API server-side with
[`@devrobotlabs/visionapi`](https://github.com/devrobotlabs/visionapi-node).

That endpoint is about four lines, and it is also where your own authorization, quota and
audit trail belong:

```ts
// app/api/vision/analyze/route.ts — Next.js App Router
import { VisionAPI, VisionAPIError } from '@devrobotlabs/visionapi';

const vision = new VisionAPI(); // reads VISION_API_KEY, server-side only

export async function POST(request: Request) {
  const user = await requireUser(request);          // your auth
  await consumeQuota(user);                          // your limits

  const form = await request.formData();
  const file = form.get('file') as File;

  try {
    const res = await vision.analyze({
      file,
      preset: String(form.get('preset') ?? 'auto'),
      // Only forward what you want callers to control.
      pages: (form.get('pages') as string) || undefined,
    });
    return Response.json(res);
  } catch (err) {
    if (err instanceof VisionAPIError) {
      // Forwarding the envelope is what lets the hooks branch on error.code.
      return Response.json({ error: { code: err.code, message: err.message, details: err.details } },
        { status: err.status });
    }
    throw err;
  }
}
```

The hooks expect `POST {baseUrl}/analyze`, `/ask`, `/detect`, and `GET {baseUrl}/tasks/:id`
and `/presets`. Full proxies for Next.js, Express and Remix are in
[`examples/`](./examples).

---

## Install

```bash
npm install @devrobotlabs/visionapi-react
```

React 18+. No dependencies of its own.

## Quick start

```tsx
import { VisionProvider, useAnalyze, unwrap } from '@devrobotlabs/visionapi-react';

function App() {
  return (
    <VisionProvider baseUrl="/api/vision">
      <ReceiptScanner />
    </VisionProvider>
  );
}

function ReceiptScanner() {
  const { analyze, data, isLoading, error, progress } = useAnalyze();

  return (
    <div>
      <input
        type="file"
        accept="image/*,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) analyze(file, { preset: 'receipt' }).catch(() => {});
        }}
      />

      {isLoading && <progress value={progress} max={1} />}
      {error && <p role="alert">{error.userMessage}</p>}

      {data && (
        <dl>
          {Object.entries(unwrap(data.result, { dropNull: true })).map(([field, value]) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
```

`analyze` returns a promise as well as driving the hook's state, so `await` it when you need
the value inline. It rejects on failure — catch it, or ignore the rejection and read
`error`, which is set either way.

---

## Hooks

### `useAnalyze()`

Extract structured data from one file.

```tsx
const { analyze, data, isLoading, error, progress, cancel, reset } = useAnalyze();

await analyze(file, {
  preset: 'invoice',            // a catalog name, or 'auto' to classify first (free)
  pages: '1-3',                 // PDF page selection; you pay for selected pages only
  min_confidence: 'mid',        // weaker values come back null, confidence preserved
  schema: { machine_serial: 'Serial number of the machine being invoiced' },
});
```

`progress` runs 0→1 during the upload, which is worth showing on a phone sending a 15 MB
scan. `cancel()` aborts the request in flight; `reset()` clears the last result for a "scan
another" button. Unmounting cancels automatically — no state is set after unmount, so the
usual "navigated away mid-upload" warning never appears.

### `useAsk()`

Up to 5 questions about one file, priced exactly like an extraction. The questions
themselves are free.

```tsx
const { ask, data } = useAsk();

await ask(file, ['Is the signature present?', 'Is the date after 2026-01-01?']);

data?.answers.map((a) => (
  <li key={a.question}>
    {a.question} → <strong>{a.verdict}</strong>: {a.answer}
  </li>
));
```

`verdict` is `'yes'`, `'no'`, `'uncertain'` (the image does not settle it — a real answer,
not a failure) or `'n/a'` (it wasn't a yes/no question). Branch on it instead of parsing the
prose.

### `useDetect()`

Ask what a file is before committing to an extraction. It is metered in batches whatever the
page count, and far cheaper than an extraction (see
[pricing](https://visionapi.io/pricing)) — cheap enough to run on every upload:

```tsx
const { detect, data } = useDetect();

const guess = await detect(file);
guess.recommended;   // exactly what preset: 'auto' would have run
guess.fallback;      // true = "shape unknown", not a match
guess.detections;    // the ranking, best first, with reasons

// "This looks like a receipt — extract it?" is a much better UX than
// paying to extract a 40-page PDF nobody looked at.
```

### `useTask()`

Poll an async task until it settles. Long PDFs and `detail: 'high'` need this: a synchronous
request is killed at 60 seconds.

```tsx
const [taskId, setTaskId] = useState<string | null>(null);
const { task, isPolling, isDone } = useTask(taskId, {
  pollInterval: 2000,
  onSettled: (task) => toast(task.status === 'completed' ? 'Done' : 'Failed'),
});

// Your endpoint submits with async: true and returns { task_id }.
const submit = async (file: File) => {
  const form = new FormData();
  form.set('file', file);
  const res = await fetch('/api/vision/analyze-async', { method: 'POST', body: form });
  setTaskId((await res.json()).task_id);
};
```

Pass `null` to poll nothing. Polling stops on its own when the task finishes, when `maxWait`
elapses, and on unmount. A transient failure mid-poll does not throw the result away — only
a terminal one (404, 410, 401, 403) stops it and lands on `error`.

### `usePresets()`

The catalog, for a picker. Fetching beats hardcoding: presets are versioned, new ones
appear, and the catalog carries the description you want next to each option.

```tsx
const { presets, isLoading } = usePresets();

<select onChange={(e) => setPreset(e.target.value)}>
  <option value="auto">Detect automatically</option>
  {presets.map((p) => (
    <option key={p.name} value={p.name} title={p.description}>
      {p.title} ({p.field_count} fields)
    </option>
  ))}
</select>
```

---

## Reading a result

Two rules explain almost every surprise:

**1. Every scalar is wrapped.** `{ value, confidence }`, where confidence is `'low'`,
`'mid'` or `'high'`. Read `data.result.total.value`, not `data.result.total`.

**2. A preset response contains every field of that preset** — including the ones the
document does not carry, which come back as `{ value: null, confidence: 'low' }`. A key
being present does not mean a value was found.

Line-item arrays are the one shape worth looking at twice: the array itself is *not*
wrapped, each **cell** inside each row is.

The helpers cover the common readings:

```tsx
import { unwrap, value, rows, belowConfidence, atLeast } from '@devrobotlabs/visionapi-react';

unwrap(data.result, { dropNull: true })   // { invoice_id: 'A-10422', total: 1284.5, … }
value(data.result, 'total', 0)            // 1284.5, or 0 when absent
rows(data.result, 'line_item')            // Row[] — [] when the invoice has no lines
belowConfidence(data.result, 'high')      // fields to highlight for review
atLeast(data.result.total, 'high')        // false when it came back "mid"
```

`unwrap()` is also the right shape to seed a controlled form — extract, prefill, let the
user correct the weak fields, save:

```tsx
const [form, setForm] = useState<Record<string, unknown>>({});
const weak = new Set(belowConfidence(data?.result, 'high'));

useEffect(() => {
  if (data) setForm(unwrap(data.result, { dropNull: true }));
}, [data]);

<input
  value={String(form.total ?? '')}
  aria-invalid={weak.has('total')}          // draw attention where confidence was low
  onChange={(e) => setForm({ ...form, total: e.target.value })}
/>
```

---

## Errors

Every failure is a `VisionError` with the HTTP `status`, the stable `code`, and whatever
`details` your endpoint forwarded. Branch on `code` — never on the message text.

```tsx
const { error } = useAnalyze();

if (error?.isInsufficientCredits) return <UpgradePrompt />;
if (error?.isTooLarge) return <p>Try a smaller file — the limit is 20 MB.</p>;
if (error?.isUnsupportedType) return <p>Use a JPEG, PNG, WebP, TIFF or PDF.</p>;
if (error) return <p role="alert">{error.userMessage}</p>;
```

`error.userMessage` is a plain sentence for each common code, so you get a decent UI without
writing a switch. The convenience flags are `isInsufficientCredits`, `isUnsupportedType`,
`isTooLarge` and `isTimeout`; anything else is `error.code`.

For this to work your proxy must **forward the API's error envelope**, as the example above
does. If it swallows it, the hooks still produce a structured `http_<status>` error.

---

## Configuration

```tsx
<VisionProvider
  baseUrl="/api/vision"                                     // your endpoint, not the API
  headers={() => ({ authorization: `Bearer ${token()}` })}  // read at request time
  credentials="same-origin"
>
```

Pass `headers` as a function when the value changes — a rotating session token read at
render time would go stale. Every hook also takes the same options directly, which is handy
for a one-off or a Storybook story:

```tsx
const { analyze } = useAnalyze({ baseUrl: '/api/vision-admin' });
```

`fetch` can be swapped for a mock, which is how this package's own tests run.

---

## Server-side rendering

The hooks are client-side: they use `useState` and `useEffect`, and the components that call
them need `'use client'` in Next.js App Router. Nothing runs during SSR — `useAnalyze`
fires only when you call `analyze`, and `useTask(null)` polls nothing. Upload progress falls
back to `fetch` where `XMLHttpRequest` does not exist, so importing the package in a server
bundle is harmless.

---

## Limits worth designing around

| Limit                        | Default | What it means for your UI                              |
| ---------------------------- | ------- | ------------------------------------------------------- |
| Max file size                | 20 MB   | Validate before upload; a 413 wastes the round trip.     |
| Max PDF pages per request    | 50      | Offer a page range for long documents.                   |
| Sync request timeout         | 60 s    | Anything longer needs the async + `useTask` path.        |
| Max questions per `ask`      | 5–10    | Per plan; the hook rejects one over the limit before sending. |
| Requests per minute, per key | 10–600  | Per plan. Shared across your whole app — the key is per account. |
| Concurrent async tasks       | 1–32    | Per plan, per *account*. Over it: 429 `too_many_tasks`.  |

Extractions are metered per image and per *selected* PDF page — a document page costs
twice an image on `analyze`, the same as an image on `ask` — and `detect` far more
cheaply. See [pricing](https://visionapi.io/pricing) for current rates and the full
per-plan matrix. Failures cost nothing, so a rejected upload never charges the user.

---

## Examples

In [`examples/`](./examples):

| File                                                          | What it shows                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| [`ReceiptScanner.tsx`](./examples/ReceiptScanner.tsx)          | Upload → extract → editable form, with confidence highlights |
| [`DetectThenAnalyze.tsx`](./examples/DetectThenAnalyze.tsx)    | Confirm the document type before spending credits            |
| [`AsyncUpload.tsx`](./examples/AsyncUpload.tsx)                | A long PDF through the queue with `useTask`                  |
| [`next-route-handler.ts`](./examples/next-route-handler.ts)    | The Next.js proxy, with auth and error forwarding            |
| [`express-proxy.ts`](./examples/express-proxy.ts)              | The same proxy for Express                                   |

---

## Development

```bash
npm install
npm run build
npm test        # offline: fetch is stubbed, hooks run under react-test-renderer
npm run typecheck
```

## Contributing

Issues and pull requests are welcome at
<https://github.com/devrobotlabs/visionapi-react>. For anything about the API itself — a preset,
a limit, an error code — <https://support.visionapi.io> reaches the team faster.

## License

[MIT](./LICENSE) © Vision API
