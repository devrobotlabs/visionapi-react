/**
 * Official React hooks for the Vision API — credit-based OCR and visual intelligence.
 *
 * The hooks talk to **your** endpoint, which holds the API key and calls the Vision API
 * server-side. There is no publishable key and no test mode, so a key in a browser bundle
 * is a spending credential anyone can read; the README shows the four-line proxy these
 * hooks expect.
 *
 * https://visionapi.io · docs: https://docs.visionapi.io
 */

export { VisionProvider, useVisionOptions } from './context.js';
export type { VisionProviderProps } from './context.js';

export { useAnalyze, useAsk, useDetect, useTask, usePresets } from './hooks.js';
export type {
  AnalyzeParams,
  MutationState,
  UseAnalyzeResult,
  UseAskResult,
  UseDetectResult,
  UseTaskOptions,
  UseTaskResult,
  UsePresetsResult,
} from './hooks.js';

export {
  VisionError,
  CancelledError,
  unwrap,
  value,
  rows,
  atLeast,
  belowConfidence,
  isField,
  isRows,
  buildFormData,
} from './core.js';

export type {
  AnalyzeResponse,
  Answer,
  ApiErrorBody,
  AskResponse,
  Confidence,
  Detection,
  DetectionCandidate,
  DetectResponse,
  ExtractionResult,
  Field,
  Modality,
  PresetSummary,
  RequestConfig,
  ResultValue,
  Row,
  Task,
  TaskStatus,
  VisionClientOptions,
} from './core.js';
