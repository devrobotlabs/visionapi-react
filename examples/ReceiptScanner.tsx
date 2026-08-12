'use client';

/**
 * Upload → extract → editable form.
 *
 * The pattern worth copying: extract at the default `min_confidence: 'low'` so nothing is
 * silently dropped, prefill a form from `unwrap()`, and mark the fields that came back
 * weakly so a person looks at those and only those.
 */

import { useEffect, useState } from 'react';
import { belowConfidence, unwrap, useAnalyze } from '@devrobotlabs/visionapi-react';

export function ReceiptScanner({ onSave }: { onSave: (receipt: Record<string, unknown>) => void }) {
  const { analyze, data, isLoading, error, progress, reset } = useAnalyze();
  const [form, setForm] = useState<Record<string, unknown>>({});

  // A preset response carries every field of the preset; dropNull leaves only what the
  // document actually had, which is the right starting point for a form.
  useEffect(() => {
    if (data) setForm(unwrap(data.result, { dropNull: true }));
  }, [data]);

  const weak = new Set(belowConfidence(data?.result, 'high'));

  return (
    <section>
      <label>
        Receipt
        <input
          type="file"
          accept="image/*,application/pdf"
          disabled={isLoading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // The promise rejects on failure too; `error` is set either way, so ignoring
            // the rejection here is deliberate rather than sloppy.
            if (file) void analyze(file, { preset: 'receipt' }).catch(() => {});
          }}
        />
      </label>

      {isLoading && (
        <p>
          <progress value={progress} max={1} /> {Math.round(progress * 100)}%
        </p>
      )}

      {error && (
        <p role="alert">
          {error.userMessage}
          {/* Retrying an out-of-credits error cannot succeed, so do not offer it. */}
          {!error.isInsufficientCredits && <button onClick={reset}>Try again</button>}
        </p>
      )}

      {data && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(form);
          }}
        >
          <p>
            {data.credits_used} credit(s) · {data.pages} page(s)
            {weak.size > 0 && ` · ${weak.size} field(s) worth checking`}
          </p>

          {Object.entries(form).map(([field, value]) =>
            Array.isArray(value) ? null : (
              <label key={field}>
                {field.replace(/_/g, ' ')}
                <input
                  value={String(value ?? '')}
                  aria-invalid={weak.has(field)}
                  onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                />
                {weak.has(field) && <small>Low confidence — please check</small>}
              </label>
            ),
          )}

          {/* A line-item array is a bare array whose cells are wrapped individually, so a
              row from unwrap() is already a plain object. */}
          {Array.isArray(form.line_item) && (
            <table>
              <tbody>
                {(form.line_item as Record<string, unknown>[]).map((line, index) => (
                  <tr key={index}>
                    <td>{String(line.description ?? '')}</td>
                    <td>{String(line.quantity ?? '')}</td>
                    <td>{String(line.amount ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <button type="submit">Save</button>
        </form>
      )}
    </section>
  );
}
