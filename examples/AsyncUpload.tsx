'use client';

/**
 * A long PDF through the queue.
 *
 * A synchronous request is killed at 60 seconds, which a 50-page contract will blow past.
 * The submission returns a task id immediately, and `useTask` polls until it settles — so
 * the tab can stay responsive, and the user can watch it progress.
 */

import { useState } from 'react';
import { unwrap, useTask } from '@devrobotlab/visionapi-react';

export function AsyncUpload() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { task, isPolling, isDone, error, stop } = useTask(taskId, {
    pollInterval: 2000,
    maxWait: 15 * 60_000,
  });

  async function submit(file: File) {
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('preset', 'contract');
      form.set('pages', '1-50');

      // Your endpoint calls analyzeAsync() and returns the { task_id } it gets back.
      const response = await fetch('/api/vision/analyze-async', { method: 'POST', body: form });
      const body = await response.json();
      setTaskId(body.task_id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <input
        type="file"
        accept="application/pdf"
        disabled={submitting}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void submit(file);
        }}
      />

      {isPolling && (
        <p>
          {task?.status === 'processing' ? 'Extracting…' : 'Queued…'}{' '}
          <button onClick={stop}>Stop watching</button>
        </p>
      )}

      {error && <p role="alert">{error.userMessage}</p>}

      {isDone && task?.status === 'failed' && (
        // A failed task costs 0 credits — the reservation is released in full.
        <p role="alert">Extraction failed ({task.error?.code}). You were not charged.</p>
      )}

      {isDone && task?.status === 'completed' && (
        <>
          <p>{task.credits_used} credits · {task.pages} pages</p>
          <pre>{JSON.stringify(unwrap(task.result, { dropNull: true }), null, 2)}</pre>
        </>
      )}
    </section>
  );
}
