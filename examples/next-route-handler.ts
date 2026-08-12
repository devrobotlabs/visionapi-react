/**
 * The server half: a Next.js App Router proxy that holds the API key.
 *
 * Put this at `app/api/vision/[...action]/route.ts` and the hooks work with
 * `<VisionProvider baseUrl="/api/vision">`. It covers all five paths they call.
 *
 *   npm install @devrobotlabs/visionapi
 */

import { VisionAPI, VisionAPIError } from '@devrobotlabs/visionapi';
import type { NextRequest } from 'next/server';

// One client for the process. VISION_API_KEY is read at construction and never leaves the
// server; nothing here is bundled for the browser.
const vision = new VisionAPI();

/** Forwarding the envelope is what lets the hooks branch on `error.code`. */
function toResponse(error: unknown): Response {
  if (error instanceof VisionAPIError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  console.error('vision proxy', error);
  return Response.json({ error: { code: 'internal_error', message: 'Something went wrong.' } }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: { action: string[] } }) {
  const action = params.action.join('/');

  // Your own authorization and quota live here — this endpoint is spending real credits on
  // the caller's behalf.
  const user = await requireUser(request);
  if (!(await hasQuota(user))) {
    return Response.json({ error: { code: 'forbidden', message: 'Monthly scan limit reached.' } }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: { code: 'invalid_request', message: 'No file.' } }, { status: 400 });
  }

  // Only forward what callers should control. Anything omitted here cannot be set from the
  // browser — which is how you stop someone passing `detail: "high"` on every request.
  const common = {
    file,
    pages: (form.get('pages') as string) || undefined,
    language_hint: (form.get('language_hint') as string) || undefined,
  };

  try {
    switch (action) {
      case 'analyze': {
        const res = await vision.analyze({
          ...common,
          preset: (form.get('preset') as string) || 'auto',
          minConfidence: (form.get('min_confidence') as 'low' | 'mid' | 'high') || undefined,
        });
        await recordUsage(user, res.credits_used);
        return Response.json(res);
      }

      case 'analyze-async': {
        const ref = await vision.analyzeAsync({
          ...common,
          preset: (form.get('preset') as string) || 'auto',
          // A stable key means a double-submit from a flaky connection replays rather
          // than charging twice.
          idempotencyKey: `${user.id}:${file.name}:${file.size}`,
        });
        return Response.json(ref, { status: 202 });
      }

      case 'ask': {
        const res = await vision.ask({ ...common, questions: form.getAll('questions').map(String) });
        await recordUsage(user, res.credits_used);
        return Response.json(res);
      }

      case 'detect': {
        const res = await vision.detect({ file });
        await recordUsage(user, res.credits_used);
        return Response.json(res);
      }

      default:
        return Response.json({ error: { code: 'not_found', message: 'Unknown action.' } }, { status: 404 });
    }
  } catch (error) {
    return toResponse(error);
  }
}

export async function GET(request: NextRequest, { params }: { params: { action: string[] } }) {
  const [resource, id] = params.action;

  try {
    if (resource === 'presets') {
      // The catalog is public and static enough to cache at the edge.
      return Response.json({ data: await vision.presets() }, {
        headers: { 'cache-control': 'public, max-age=3600' },
      });
    }

    if (resource === 'tasks' && id) {
      const user = await requireUser(request);
      // Check the task belongs to this user before handing back customer content.
      await assertOwnsTask(user, id);
      return Response.json(await vision.getTask(id));
    }

    return Response.json({ error: { code: 'not_found', message: 'Unknown resource.' } }, { status: 404 });
  } catch (error) {
    return toResponse(error);
  }
}

/* Your own functions — stubs so this file reads as a whole. */
declare function requireUser(request: NextRequest): Promise<{ id: string }>;
declare function hasQuota(user: { id: string }): Promise<boolean>;
declare function recordUsage(user: { id: string }, credits: number): Promise<void>;
declare function assertOwnsTask(user: { id: string }, taskId: string): Promise<void>;
