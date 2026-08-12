/**
 * The same proxy for Express.
 *
 *   npm install @devrobotlab/visionapi express multer
 *
 * Mount it at /api/vision and the hooks work with
 * `<VisionProvider baseUrl="/api/vision">`.
 */

import { VisionAPI, VisionAPIError } from '@devrobotlab/visionapi';
import express from 'express';
import multer from 'multer';

const vision = new VisionAPI(); // reads VISION_API_KEY, server-side only

// 20 MB is the API's own limit; rejecting here saves the upload rather than the round trip.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const visionRouter = express.Router();

/** Forwarding the envelope is what lets the hooks branch on `error.code`. */
function send(res: express.Response, error: unknown) {
  if (error instanceof VisionAPIError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  console.error('vision proxy', error);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
}

visionRouter.post('/analyze', requireUser, upload.single('file'), async (req, res) => {
  try {
    const result = await vision.analyze({
      file: { data: req.file!.buffer, filename: req.file!.originalname },
      preset: req.body.preset || 'auto',
      pages: req.body.pages || undefined,
      minConfidence: req.body.min_confidence || undefined,
    });
    await recordUsage(req.user!, result.credits_used);
    res.json(result);
  } catch (error) {
    send(res, error);
  }
});

visionRouter.post('/detect', requireUser, upload.single('file'), async (req, res) => {
  try {
    res.json(await vision.detect({ file: { data: req.file!.buffer, filename: req.file!.originalname } }));
  } catch (error) {
    send(res, error);
  }
});

visionRouter.post('/ask', requireUser, upload.single('file'), async (req, res) => {
  try {
    const questions = Array.isArray(req.body.questions) ? req.body.questions : [req.body.questions];
    const result = await vision.ask({
      file: { data: req.file!.buffer, filename: req.file!.originalname },
      questions,
    });
    await recordUsage(req.user!, result.credits_used);
    res.json(result);
  } catch (error) {
    send(res, error);
  }
});

visionRouter.get('/tasks/:id', requireUser, async (req, res) => {
  try {
    // Check the task belongs to this user before handing back customer content.
    await assertOwnsTask(req.user!, req.params.id);
    res.json(await vision.getTask(req.params.id));
  } catch (error) {
    send(res, error);
  }
});

visionRouter.get('/presets', async (_req, res) => {
  try {
    res.set('cache-control', 'public, max-age=3600');
    res.json({ data: await vision.presets() });
  } catch (error) {
    send(res, error);
  }
});

/* Your own middleware — stubs so this file reads as a whole. */
declare function requireUser(req: express.Request, res: express.Response, next: express.NextFunction): void;
declare function recordUsage(user: unknown, credits: number): Promise<void>;
declare function assertOwnsTask(user: unknown, taskId: string): Promise<void>;

declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}
