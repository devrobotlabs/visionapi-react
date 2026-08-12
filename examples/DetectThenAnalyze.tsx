'use client';

/**
 * Confirm the document type before spending credits.
 *
 * `detect` costs 1 credit per 5 calls whatever the page count, because it only reads page
 * 1 — so it is cheap enough to run on every upload. Extraction costs 1 per page, which is
 * why asking first is worth it for a 40-page PDF nobody has looked at.
 */

import { useState } from 'react';
import { unwrap, useAnalyze, useDetect } from '@devrobotlabs/visionapi-react';
import type { DetectResponse } from '@devrobotlabs/visionapi-react';

export function DetectThenAnalyze() {
  const [file, setFile] = useState<File | null>(null);
  const [guess, setGuess] = useState<DetectResponse | null>(null);

  const { detect, isLoading: isDetecting } = useDetect();
  const { analyze, data, isLoading: isAnalyzing, error } = useAnalyze();

  return (
    <section>
      <input
        type="file"
        accept="image/*,application/pdf"
        onChange={async (event) => {
          const picked = event.target.files?.[0] ?? null;
          setFile(picked);
          setGuess(null);
          if (picked) setGuess(await detect(picked).catch(() => null));
        }}
      />

      {isDetecting && <p>Working out what this is…</p>}

      {guess && (
        // `fallback` means nothing matched confidently and the generic preset was
        // substituted. That is "shape unknown", not a match — say so rather than pretending.
        guess.fallback ? (
          <p>
            We could not tell what this is
            {guess.detections[0] && ` — closest guess: ${guess.detections[0].preset}`}. Extract
            it as a generic document?
            <button onClick={() => file && analyze(file, { preset: 'document' })}>Extract anyway</button>
          </p>
        ) : (
          <p>
            This looks like a <strong>{guess.recommended}</strong>.
            <button
              disabled={isAnalyzing}
              onClick={() => file && analyze(file, { preset: guess.recommended })}
            >
              Extract it
            </button>
            {guess.detections.length > 1 && (
              <select onChange={(event) => file && analyze(file, { preset: event.target.value })}>
                <option>…or pick another</option>
                {guess.detections.map((candidate) => (
                  <option key={candidate.preset} value={candidate.preset} title={candidate.reason}>
                    {candidate.preset} ({candidate.confidence})
                  </option>
                ))}
              </select>
            )}
          </p>
        )
      )}

      {error && <p role="alert">{error.userMessage}</p>}
      {data && <pre>{JSON.stringify(unwrap(data.result, { dropNull: true }), null, 2)}</pre>}
    </section>
  );
}
