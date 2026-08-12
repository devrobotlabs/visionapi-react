/**
 * The browser half of a Vision API integration.
 *
 * Everything here talks to **your** endpoint, not to `api.visionapi.io` directly. There is
 * no publishable key and no test mode: an API key is a live spending credential, so it
 * belongs on a server that can also apply your own authorization and quota. The hooks in
 * this package are built for that shape — see the README's *Backend* section for the
 * four-line proxy they expect.
 *
 * Types mirror the wire format exactly (`snake_case`), because the response shape is the
 * public contract and renaming it would make https://docs.visionapi.io stop matching what
 * you see in your editor.
 */

/* --------------------------------------------------------------- results */

/** Confidence attached to every extracted scalar. */
export type Confidence = 'low' | 'mid' | 'high';

/** The modality the classifier assigns before it picks a preset. */
export type Modality = 'document' | 'image';

/** Lifecycle of an async task. */
export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * A wrapped scalar. A key being present does not mean a value was found: a preset response
 * contains *all* of the preset's fields, and the ones the document does not carry come back
 * as `{ value: null, confidence: 'low' }`.
 */
export interface Field<T = unknown> {
  value: T | null;
  confidence: Confidence;
}

/** One row of a line-item array. Confidence is per **cell**, not per row. */
export type Row = Record<string, Field>;

/**
 * What a field can hold: a wrapped scalar, a bare array of rows, or a block of members.
 * The array and the block themselves are *not* wrapped — only the cells inside them.
 */
export type ResultValue = Field | Row[] | Row;

/** A preset or custom-schema extraction, keyed by field name. */
export type ExtractionResult = Record<string, ResultValue>;

export interface DetectionCandidate {
  preset: string;
  confidence: Confidence;
  reason: string;
}

export interface Detection {
  preset: string;
  modality: Modality;
  confidence: Confidence;
  /** `true` when nothing matched confidently. Treat it as "shape unknown", not a match. */
  fallback: boolean;
  /** The rest of the ranking, best first. Never contains the preset that ran. */
  alternatives: DetectionCandidate[];
}

export interface AnalyzeResponse {
  id: string;
  status: 'completed';
  credits_used: number;
  credits_remaining: number;
  pages: number;
  preset?: string;
  schema_name?: string;
  result?: ExtractionResult;
  text?: string;
  full_text?: string;
  detection?: Detection;
}

export interface Answer {
  question: string;
  answer: string;
  /** Branch on this rather than parsing the prose. */
  verdict: 'yes' | 'no' | 'uncertain' | 'n/a';
  confidence: Confidence;
}

export interface AskResponse {
  id: string;
  status: 'completed';
  credits_used: number;
  credits_remaining: number;
  pages: number;
  answers: Answer[];
}

export interface DetectResponse {
  id: string;
  status: 'completed';
  /** 0 on four calls out of five — detection is metered at 1 credit per 5 calls. */
  credits_used: number;
  credits_remaining: number;
  pages: number;
  modality: Modality;
  /** What `preset: 'auto'` would have run on this file. */
  recommended: string;
  fallback: boolean;
  detections: DetectionCandidate[];
}

export interface Task {
  task_id: string;
  status: TaskStatus;
  endpoint?: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
  credits_reserved?: number;
  credits_used?: number;
  error?: ApiErrorBody;
  result?: ExtractionResult;
  answers?: Answer[];
  text?: string;
  full_text?: string;
  pages?: number;
  preset?: string;
  detection?: Detection;
}

export interface PresetSummary {
  name: string;
  title: string;
  kind: Modality;
  version: number;
  description: string;
  field_count: number;
  supports_line_item_custom_fields: boolean;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/* ---------------------------------------------------------------- errors */

/**
 * A failure your endpoint reported.
 *
 * If it forwards the API's error envelope — which the README's proxy does — `code` is the
 * API's stable value and you can branch on it. Otherwise it falls back to `http_<status>`,
 * still structured.
 */
export class VisionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(`${body.code}: ${body.message}`);
    this.name = 'VisionError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  /** `true` when the balance ran out. Do not offer a retry button for this one. */
  get isInsufficientCredits(): boolean {
    return this.code === 'insufficient_credits';
  }

  /** `true` when the user picked something that is not an image or a PDF. */
  get isUnsupportedType(): boolean {
    return this.code === 'unsupported_type';
  }

  /** `true` when the file is over 20 MB or over 50 pages. */
  get isTooLarge(): boolean {
    return this.code === 'file_too_large' || this.code === 'page_limit_exceeded';
  }

  /**
   * `true` when the request passed the 60-second synchronous limit. Re-submit through an
   * async endpoint rather than retrying the same call.
   */
  get isTimeout(): boolean {
    return this.code === 'sync_timeout';
  }

  /** A sentence you can put in front of a user. */
  get userMessage(): string {
    switch (this.code) {
      case 'insufficient_credits':
        return 'Out of credits.';
      case 'unsupported_type':
        return 'That file type is not supported. Use a JPEG, PNG, WebP, TIFF or PDF.';
      case 'file_too_large':
        return 'That file is too large. The limit is 20 MB.';
      case 'page_limit_exceeded':
        return 'That PDF has too many pages. The limit is 50 per request.';
      case 'pdf_encrypted':
        return 'That PDF is password-protected.';
      case 'rate_limited':
        return 'Too many requests just now. Try again in a moment.';
      case 'too_many_tasks':
        return 'Too many jobs running at once. Wait for one to finish, then try again.';
      case 'sync_timeout':
        return 'That took too long to process. Try a smaller page range.';
      case 'provider_error':
      case 'internal_error':
        return 'Something went wrong on our side. Try again.';
      default:
        return 'That did not work. Please try again.';
    }
  }
}

/** Aborting a request throws this rather than a `VisionError`. */
export class CancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'CancelledError';
  }
}

/* ------------------------------------------------------------- transport */

/** Options every hook accepts, and what ``VisionProvider`` supplies as defaults. */
export interface VisionClientOptions {
  /**
   * Your endpoint's base path — the server that holds the API key. Defaults to
   * `/api/vision`. Never point this at `https://api.visionapi.io`: that would mean shipping
   * a key to the browser.
   */
  baseUrl?: string;
  /** Extra headers on every request — your own session token, a CSRF token. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Sent as `credentials` on every fetch. Defaults to `'same-origin'`. */
  credentials?: RequestCredentials;
  /** Swap in your own fetch (a mock in tests, an instrumented one in production). */
  fetch?: typeof fetch;
}

export interface RequestConfig {
  signal?: AbortSignal;
  /** Called with 0–1 while the file uploads. Requires the XHR path; see `upload`. */
  onProgress?: (fraction: number) => void;
}

function resolveHeaders(options: VisionClientOptions): Record<string, string> {
  const headers = typeof options.headers === 'function' ? options.headers() : options.headers;
  return headers ?? {};
}

function endpoint(options: VisionClientOptions, path: string): string {
  const base = (options.baseUrl ?? '/api/vision').replace(/\/+$/, '');
  return `${base}${path}`;
}

async function toError(response: Response): Promise<VisionError> {
  let body: ApiErrorBody = {
    code: `http_${response.status}`,
    message: response.statusText || 'Request failed',
  };
  try {
    const parsed = (await response.json()) as { error?: ApiErrorBody };
    if (parsed?.error?.code) body = parsed.error;
  } catch {
    // A proxy that does not forward the envelope still produces a structured error.
  }
  return new VisionError(response.status, body);
}

/** A plain `fetch` call against your endpoint. */
export async function request<T>(
  options: VisionClientOptions,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(endpoint(options, path), {
    credentials: options.credentials ?? 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...resolveHeaders(options), ...init.headers },
  });

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * A POST that can report upload progress.
 *
 * `fetch` cannot report request-body progress in any browser today, so this drops to
 * `XMLHttpRequest` when `onProgress` is supplied and uses `fetch` otherwise. That is the
 * whole reason this function exists — a progress bar on a 20 MB PDF is worth the branch.
 */
export function upload<T>(
  options: VisionClientOptions,
  path: string,
  body: FormData,
  config: RequestConfig = {},
): Promise<T> {
  // XHR is the only way to observe request-body progress today, but it does not exist
  // during SSR or in a test runner — so fall back to fetch whenever it is absent, or
  // whenever the caller never asked for progress in the first place.
  if (!config.onProgress || typeof XMLHttpRequest === 'undefined') {
    return request<T>(options, path, { method: 'POST', body, signal: config.signal });
  }

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint(options, path));
    xhr.withCredentials = (options.credentials ?? 'same-origin') === 'include';
    xhr.responseType = 'text';

    for (const [name, value] of Object.entries(resolveHeaders(options))) {
      xhr.setRequestHeader(name, value);
    }
    xhr.setRequestHeader('accept', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) config.onProgress?.(event.loaded / event.total);
    };

    xhr.onload = () => {
      let parsed: unknown;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        parsed = undefined;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        config.onProgress?.(1);
        resolve(parsed as T);
        return;
      }

      const envelope = (parsed as { error?: ApiErrorBody } | undefined)?.error;
      reject(
        new VisionError(xhr.status, envelope ?? {
          code: `http_${xhr.status}`,
          message: xhr.statusText || 'Request failed',
        }),
      );
    };

    xhr.onerror = () => reject(new VisionError(0, { code: 'network_error', message: 'Network error' }));
    xhr.onabort = () => reject(new CancelledError());

    config.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/**
 * Build the multipart body your endpoint receives.
 *
 * Field names match the API's own, so a proxy can forward the form straight through
 * without translating anything.
 */
export function buildFormData(
  file: File | Blob,
  params: Record<string, unknown> | object = {},
): FormData {
  const form = new FormData();
  // Duck-typed rather than `file instanceof File`. File only became a global in Node 20, so
  // the instanceof throws ReferenceError on Node 18 — in an SSR render, a proxy route or the
  // test runner — for any plain Blob. Reading `.name` behaves identically in every browser
  // and degrades to the fallback wherever it is absent.
  const filename = typeof (file as File).name === 'string' ? (file as File).name : 'upload';
  form.set('file', file, filename);
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
    } else if (typeof value === 'object') {
      form.set(key, JSON.stringify(value));
    } else {
      form.set(key, String(value));
    }
  }
  return form;
}

/* --------------------------------------------------------------- helpers */

/** Narrow a {@link ResultValue} to a scalar leaf. */
export function isField(value: ResultValue | undefined): value is Field {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in value &&
    'confidence' in value
  );
}

/** Narrow a {@link ResultValue} to a line-item array. */
export function isRows(value: ResultValue | undefined): value is Row[] {
  return Array.isArray(value);
}

/**
 * Drop the `{ value, confidence }` wrappers, recursively — the shape you want for
 * rendering, or for a controlled form's initial state.
 */
export function unwrap(
  result: ExtractionResult | undefined,
  options: { dropNull?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result ?? {})) {
    if (isRows(value)) {
      const rows = value.map((row) => unwrap(row as ExtractionResult, options));
      if (options.dropNull && rows.length === 0) continue;
      out[key] = rows;
    } else if (isField(value)) {
      if (options.dropNull && (value.value === null || value.value === undefined)) continue;
      out[key] = value.value ?? null;
    } else if (value && typeof value === 'object') {
      out[key] = unwrap(value as ExtractionResult, options);
    }
  }
  return out;
}

/** Read a scalar field's value, with a fallback for "absent or null". */
export function value<T = unknown>(
  result: ExtractionResult | undefined,
  name: string,
  fallback: T | null = null,
): T | null {
  const node = result?.[name];
  return isField(node) ? ((node.value as T | null) ?? fallback) : fallback;
}

/** Read a line-item array. `[]` when the field is absent or the document had no lines. */
export function rows(result: ExtractionResult | undefined, name: string): Row[] {
  const node = result?.[name];
  return isRows(node) ? node : [];
}

const ORDER: Record<Confidence, number> = { low: 0, mid: 1, high: 2 };

/** `true` when the field has a value and its confidence meets `level`. */
export function atLeast(field: ResultValue | undefined, level: Confidence): boolean {
  return isField(field) && field.value !== null && ORDER[field.confidence] >= ORDER[level];
}

/**
 * The fields found but below `level` — what to highlight for review in a form. Extract at
 * the default `min_confidence: 'low'` so nothing is silently dropped, then let a person
 * confirm the weak ones.
 */
export function belowConfidence(
  result: ExtractionResult | undefined,
  level: Confidence,
): string[] {
  return Object.entries(result ?? {})
    .filter(([, node]) => isField(node) && node.value !== null && !atLeast(node, level))
    .map(([key]) => key);
}
