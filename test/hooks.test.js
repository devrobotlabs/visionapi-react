/**
 * Offline tests. No API key, no network — `fetch` is stubbed and the hooks run under
 * react-test-renderer's act().
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  VisionError,
  VisionProvider,
  belowConfidence,
  rows,
  unwrap,
  useAnalyze,
  useAsk,
  useDetect,
  usePresets,
  useTask,
  value,
} from '../dist/index.js';

/** A `fetch` that replays canned responses and records what it was called with. */
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

/** Renders a hook and gives back a live view of its return value. */
async function renderHook(hook, wrapperProps) {
  const state = { current: null };

  function Probe() {
    state.current = hook();
    return null;
  }

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      wrapperProps
        ? createElement(VisionProvider, wrapperProps, createElement(Probe))
        : createElement(Probe),
    );
  });

  return {
    state,
    async act(fn) {
      let result;
      await act(async () => {
        result = await fn();
      });
      return result;
    },
    unmount() {
      act(() => renderer.unmount());
    },
  };
}

const FILE = new Blob(['fake bytes'], { type: 'image/png' });

test('useAnalyze posts multipart to your endpoint and exposes the result', async () => {
  const { fetchImpl, calls } = stubFetch([
    {
      status: 200,
      body: {
        id: 'req_1',
        status: 'completed',
        credits_used: 1,
        credits_remaining: 10,
        pages: 1,
        result: { total: { value: 12.5, confidence: 'high' } },
      },
    },
  ]);

  const view = await renderHook(() => useAnalyze(), {
    baseUrl: '/api/vision',
    fetch: fetchImpl,
    headers: { authorization: 'Bearer session-token' },
  });

  assert.equal(view.state.current.isLoading, false);
  assert.equal(view.state.current.data, null);

  await view.act(() => view.state.current.analyze(FILE, { preset: 'receipt', min_confidence: 'mid' }));

  assert.equal(view.state.current.data.result.total.value, 12.5);
  assert.equal(view.state.current.isLoading, false);
  assert.equal(view.state.current.error, null);

  const call = calls[0];
  assert.equal(call.url, '/api/vision/analyze', 'requests go to your server, never to the API directly');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.authorization, 'Bearer session-token');
  assert.equal(call.init.credentials, 'same-origin');
  assert.equal(call.init.body.get('preset'), 'receipt');
  assert.equal(call.init.body.get('min_confidence'), 'mid');
  assert.ok(call.init.body.get('file'));

  view.unmount();
});

test('a failure lands on error, not as an unhandled rejection', async () => {
  const { fetchImpl } = stubFetch([
    {
      status: 402,
      body: {
        error: {
          code: 'insufficient_credits',
          message: 'This request requires 3 credits but only 1 are available.',
          details: { required: 3, available: 1 },
        },
      },
    },
  ]);

  const view = await renderHook(() => useAnalyze(), { fetch: fetchImpl });

  await view.act(async () => {
    await view.state.current.analyze(FILE, { preset: 'receipt' }).catch(() => {});
  });

  const { error } = view.state.current;
  assert.ok(error instanceof VisionError);
  assert.equal(error.code, 'insufficient_credits');
  assert.equal(error.status, 402);
  assert.equal(error.isInsufficientCredits, true);
  assert.equal(error.details.required, 3);
  assert.equal(error.userMessage, 'Out of credits.');

  view.unmount();
});

test('a proxy that swallows the envelope still produces a structured error', async () => {
  const { fetchImpl } = stubFetch([{ status: 500, body: { oops: true } }]);
  const view = await renderHook(() => useAnalyze(), { fetch: fetchImpl });

  await view.act(async () => {
    await view.state.current.analyze(FILE).catch(() => {});
  });

  assert.equal(view.state.current.error.code, 'http_500');
  view.unmount();
});

test('reset clears the last result', async () => {
  const { fetchImpl } = stubFetch([{ status: 200, body: { id: 'req_2' } }]);
  const view = await renderHook(() => useAnalyze(), { fetch: fetchImpl });

  await view.act(() => view.state.current.analyze(FILE));
  assert.equal(view.state.current.data.id, 'req_2');

  await view.act(async () => view.state.current.reset());
  assert.equal(view.state.current.data, null);

  view.unmount();
});

test('useAsk rejects more than five questions without sending anything', async () => {
  const { fetchImpl, calls } = stubFetch([]);
  const view = await renderHook(() => useAsk(), { fetch: fetchImpl });

  await view.act(async () => {
    await view.state.current.ask(FILE, ['1', '2', '3', '4', '5', '6']).catch(() => {});
  });

  assert.equal(view.state.current.error.code, 'too_many_questions');
  assert.equal(calls.length, 0, 'nothing reached the network, so nothing could be charged');

  view.unmount();
});

test('useDetect posts to /detect', async () => {
  const { fetchImpl, calls } = stubFetch([
    { status: 200, body: { id: 'req_3', recommended: 'receipt', fallback: false, credits_used: 0, detections: [] } },
  ]);
  const view = await renderHook(() => useDetect(), { fetch: fetchImpl });

  await view.act(() => view.state.current.detect(FILE));

  assert.equal(view.state.current.data.recommended, 'receipt');
  assert.equal(calls[0].url, '/api/vision/detect');

  view.unmount();
});

test('useTask polls until the task settles and then stops', async () => {
  const { fetchImpl, calls } = stubFetch([
    { status: 200, body: { task_id: 'task_1', status: 'processing' } },
    {
      status: 200,
      body: {
        task_id: 'task_1',
        status: 'completed',
        credits_used: 3,
        result: { total: { value: 9, confidence: 'high' } },
      },
    },
  ]);

  let settled = null;
  const view = await renderHook(
    () => useTask('task_1', { pollInterval: 1, onSettled: (task) => (settled = task) }),
    { fetch: fetchImpl },
  );

  await view.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  assert.equal(view.state.current.task.status, 'completed');
  assert.equal(view.state.current.isDone, true);
  assert.equal(view.state.current.isPolling, false);
  assert.equal(settled?.task_id, 'task_1');
  assert.equal(calls.length, 2, 'polling stops as soon as the task settles');
  assert.equal(calls[0].url, '/api/vision/tasks/task_1');

  view.unmount();
});

test('useTask with a null id polls nothing', async () => {
  const { fetchImpl, calls } = stubFetch([]);
  const view = await renderHook(() => useTask(null), { fetch: fetchImpl });

  await view.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.equal(calls.length, 0);
  assert.equal(view.state.current.task, null);

  view.unmount();
});

test('usePresets loads the catalog', async () => {
  const { fetchImpl, calls } = stubFetch([
    { status: 200, body: { data: [{ name: 'invoice', field_count: 37 }, { name: 'receipt', field_count: 14 }] } },
  ]);

  const view = await renderHook(() => usePresets(), { fetch: fetchImpl });

  await view.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  assert.equal(view.state.current.presets.length, 2);
  assert.equal(view.state.current.isLoading, false);
  assert.equal(calls[0].url, '/api/vision/presets');

  view.unmount();
});

test('helpers understand leaves, rows and absent values', () => {
  const result = {
    invoice_id: { value: 'A-1', confidence: 'high' },
    carrier: { value: null, confidence: 'low' },
    total: { value: 10, confidence: 'mid' },
    line_item: [
      {
        description: { value: 'Widget', confidence: 'high' },
        amount: { value: 25, confidence: 'high' },
      },
    ],
  };

  assert.deepEqual(unwrap(result, { dropNull: true }), {
    invoice_id: 'A-1',
    total: 10,
    line_item: [{ description: 'Widget', amount: 25 }],
  });
  assert.equal(value(result, 'invoice_id'), 'A-1');
  assert.equal(value(result, 'carrier', 'fallback'), 'fallback');
  assert.equal(rows(result, 'line_item').length, 1);
  assert.deepEqual(belowConfidence(result, 'high'), ['total']);
});
