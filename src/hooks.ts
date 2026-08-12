import { useCallback, useEffect, useRef, useState } from 'react';
import { useVisionOptions } from './context.js';
import {
  buildFormData,
  CancelledError,
  request,
  upload,
  VisionError,
} from './core.js';
import type {
  AnalyzeResponse,
  AskResponse,
  Confidence,
  DetectResponse,
  PresetSummary,
  RequestConfig,
  Task,
  VisionClientOptions,
} from './core.js';

/** What every mutation hook returns. */
export interface MutationState<T> {
  /** The last successful response, or `null` before the first one. */
  data: T | null;
  /** `true` while a request is in flight. */
  isLoading: boolean;
  /** The last failure, cleared when a new request starts. */
  error: VisionError | null;
  /** Upload progress, 0–1. Only moves when the call passes `onProgress`-capable options. */
  progress: number;
  /** Aborts the request in flight. Safe to call when there is none. */
  cancel: () => void;
  /** Clears `data`, `error` and `progress` — for a "scan another" button. */
  reset: () => void;
}

interface MutationHandle<T> extends MutationState<T> {
  run: (send: (config: RequestConfig) => Promise<T>) => Promise<T>;
}

/**
 * The shared machinery: one request at a time, cancellable, and never setting state after
 * unmount — which is what turns "works in dev" into "works in a real app where people
 * navigate away mid-upload".
 */
function useMutation<T>(): MutationHandle<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<VisionError | null>(null);
  const [progress, setProgress] = useState(0);

  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    if (mounted.current) setLoading(false);
  }, []);

  const reset = useCallback(() => {
    if (!mounted.current) return;
    setData(null);
    setError(null);
    setProgress(0);
  }, []);

  const run = useCallback(async (send: (config: RequestConfig) => Promise<T>) => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;

    if (mounted.current) {
      setLoading(true);
      setError(null);
      setProgress(0);
    }

    try {
      const result = await send({
        signal: next.signal,
        onProgress: (fraction) => {
          if (mounted.current) setProgress(fraction);
        },
      });
      if (mounted.current) {
        setData(result);
        setLoading(false);
      }
      return result;
    } catch (err) {
      if (mounted.current && !(err instanceof CancelledError) && !next.signal.aborted) {
        setLoading(false);
        setError(
          err instanceof VisionError
            ? err
            : new VisionError(0, { code: 'network_error', message: String(err) }),
        );
      } else if (mounted.current) {
        setLoading(false);
      }
      throw err;
    }
  }, []);

  return { data, isLoading, error, progress, cancel, reset, run };
}

/** Parameters an extraction accepts. They are forwarded to your endpoint verbatim. */
export interface AnalyzeParams {
  /** A catalog name, or `'auto'` to let the API classify the file first (free). */
  preset?: string;
  /** Custom fields, alone or on top of a preset. */
  schema?: Record<string, unknown>;
  /** A schema saved in your dashboard. Mutually exclusive with `preset` and `schema`. */
  schema_name?: string;
  /** PDF page selection, e.g. `'1-3,7'`. You are charged for selected pages only. */
  pages?: string;
  language_hint?: string;
  /** `'high'` renders pages at higher resolution. Same credit cost, slower. */
  detail?: 'standard' | 'high';
  output?: 'json' | 'text';
  include_raw_text?: boolean;
  /** Fields below this level come back `null`, with confidence preserved. */
  min_confidence?: Confidence;
}

export interface UseAnalyzeResult extends MutationState<AnalyzeResponse> {
  /** Uploads the file and resolves with the extraction. Throws on failure. */
  analyze: (file: File | Blob, params?: AnalyzeParams) => Promise<AnalyzeResponse>;
}

/**
 * Extract structured data from one file the user picked.
 *
 * ```tsx
 * const { analyze, data, isLoading, error, progress } = useAnalyze();
 *
 * <input type="file" onChange={(e) => analyze(e.target.files![0], { preset: 'receipt' })} />
 * {isLoading && <progress value={progress} />}
 * {error && <p>{error.userMessage}</p>}
 * {data && <pre>{JSON.stringify(unwrap(data.result, { dropNull: true }), null, 2)}</pre>}
 * ```
 *
 * The request goes to `POST {baseUrl}/analyze` on your own server, which holds the API key.
 * `progress` tracks the upload, which matters on a phone uploading a 15 MB scan.
 */
export function useAnalyze(options?: VisionClientOptions): UseAnalyzeResult {
  const resolved = useVisionOptions(options);
  const { run, ...state } = useMutation<AnalyzeResponse>();

  const analyze = useCallback(
    (file: File | Blob, params: AnalyzeParams = {}) =>
      run((config) => upload<AnalyzeResponse>(resolved, '/analyze', buildFormData(file, params), config)),
    [resolved, run],
  );

  return { ...state, analyze };
}

export interface UseAskResult extends MutationState<AskResponse> {
  /** Up to 5 questions about one file. The questions themselves are free. */
  ask: (file: File | Blob, questions: string[], params?: Omit<AnalyzeParams, 'preset' | 'schema' | 'schema_name'>) => Promise<AskResponse>;
}

/**
 * Ask up to 5 questions about one file, priced exactly like an extraction.
 *
 * Branch on `answer.verdict` (`'yes' | 'no' | 'uncertain' | 'n/a'`) rather than parsing the
 * prose — `'uncertain'` is a real answer meaning the image does not settle the question.
 */
export function useAsk(options?: VisionClientOptions): UseAskResult {
  const resolved = useVisionOptions(options);
  const { run, ...state } = useMutation<AskResponse>();

  const ask = useCallback(
    (file: File | Blob, questions: string[], params = {}) =>
      // The check runs inside `run` so a bad call lands on `error` like any other failure,
      // rather than rejecting past the hook's state.
      run((config) => {
        if (questions.length === 0 || questions.length > 5) {
          throw new VisionError(0, {
            code: 'too_many_questions',
            message: `Provide 1 to 5 questions — received ${questions.length}.`,
          });
        }
        return upload<AskResponse>(resolved, '/ask', buildFormData(file, { ...params, questions }), config);
      }),
    [resolved, run],
  );

  return { ...state, ask };
}

export interface UseDetectResult extends MutationState<DetectResponse> {
  /** Identify what a file is without paying to extract it. */
  detect: (file: File | Blob, params?: { detail?: 'standard' | 'high' }) => Promise<DetectResponse>;
}

/**
 * Ask what a file is before committing to an extraction.
 *
 * Metered at 1 credit per 5 calls whatever the page count, so it is cheap enough to run on
 * every upload — useful for showing "this looks like a receipt" and letting the user
 * confirm before you spend real credits. `recommended` is exactly what `preset: 'auto'`
 * would have run.
 */
export function useDetect(options?: VisionClientOptions): UseDetectResult {
  const resolved = useVisionOptions(options);
  const { run, ...state } = useMutation<DetectResponse>();

  const detect = useCallback(
    (file: File | Blob, params: { detail?: 'standard' | 'high' } = {}) =>
      run((config) => upload<DetectResponse>(resolved, '/detect', buildFormData(file, params), config)),
    [resolved, run],
  );

  return { ...state, detect };
}

export interface UseTaskOptions extends VisionClientOptions {
  /** Milliseconds between polls. Default 2 000, which is what the docs recommend. */
  pollInterval?: number;
  /** Stop polling after this long. Default 600 000 (10 minutes). */
  maxWait?: number;
  /** Called once when the task reaches `completed` or `failed`. */
  onSettled?: (task: Task) => void;
}

export interface UseTaskResult {
  task: Task | null;
  isPolling: boolean;
  error: VisionError | null;
  /** `true` once the task reaches `completed` or `failed`. */
  isDone: boolean;
  /** Stop polling now. The task itself keeps running server-side. */
  stop: () => void;
}

/**
 * Poll an async task until it settles.
 *
 * Pass `null` to poll nothing — which is how you keep the hook mounted while waiting for a
 * submission to return an id:
 *
 * ```tsx
 * const [taskId, setTaskId] = useState<string | null>(null);
 * const { task, isDone } = useTask(taskId);
 * ```
 *
 * Polling stops on its own when the task finishes, when `maxWait` elapses, and when the
 * component unmounts. A 429 while polling is not fatal — the hook keeps its previous task
 * and backs off to the next interval.
 */
export function useTask(taskId: string | null, options: UseTaskOptions = {}): UseTaskResult {
  const resolved = useVisionOptions(options);
  const { pollInterval = 2000, maxWait = 600_000, onSettled } = options;

  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<VisionError | null>(null);
  const [isPolling, setPolling] = useState(false);

  const stopped = useRef(false);
  const settledFor = useRef<string | null>(null);

  const stop = useCallback(() => {
    stopped.current = true;
    setPolling(false);
  }, []);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setError(null);
      setPolling(false);
      return;
    }

    stopped.current = false;
    settledFor.current = null;
    setPolling(true);
    setError(null);

    const controller = new AbortController();
    const deadline = Date.now() + maxWait;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped.current || controller.signal.aborted) return;

      try {
        const next = await request<Task>(resolved, `/tasks/${encodeURIComponent(taskId)}`, {
          signal: controller.signal,
        });
        if (stopped.current || controller.signal.aborted) return;

        setTask(next);

        if (next.status === 'completed' || next.status === 'failed') {
          setPolling(false);
          if (settledFor.current !== taskId) {
            settledFor.current = taskId;
            onSettled?.(next);
          }
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // A transient failure while polling should not throw the result away; only a
        // terminal one (404, 410) is worth surfacing and stopping for.
        const visionError = err instanceof VisionError ? err : null;
        if (visionError && [404, 410, 401, 403].includes(visionError.status)) {
          setError(visionError);
          setPolling(false);
          return;
        }
      }

      if (Date.now() >= deadline) {
        setPolling(false);
        return;
      }
      timer = setTimeout(poll, pollInterval);
    };

    void poll();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // `onSettled` is deliberately not a dependency: an inline callback would restart polling
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, pollInterval, maxWait, resolved]);

  return {
    task,
    isPolling,
    error,
    isDone: task?.status === 'completed' || task?.status === 'failed',
    stop,
  };
}

export interface UsePresetsResult {
  presets: PresetSummary[];
  isLoading: boolean;
  error: VisionError | null;
  reload: () => void;
}

/**
 * The preset catalog, for a picker.
 *
 * Fetching it beats hardcoding a list: presets are versioned, new ones appear, and the
 * catalog carries the descriptions you want next to each option.
 */
export function usePresets(options?: VisionClientOptions): UsePresetsResult {
  const resolved = useVisionOptions(options);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<VisionError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    request<{ data: PresetSummary[] }>(resolved, '/presets', { signal: controller.signal })
      .then((body) => {
        if (controller.signal.aborted) return;
        setPresets(body.data ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof VisionError ? err : new VisionError(0, { code: 'network_error', message: String(err) }));
        setLoading(false);
      });

    return () => controller.abort();
  }, [resolved, nonce]);

  return { presets, isLoading, error, reload: () => setNonce((n) => n + 1) };
}
