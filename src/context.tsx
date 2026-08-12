import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { VisionClientOptions } from './core.js';

const VisionContext = createContext<VisionClientOptions | null>(null);

export interface VisionProviderProps extends VisionClientOptions {
  children: ReactNode;
}

/**
 * Supplies every hook below it with your endpoint's base path and headers.
 *
 * ```tsx
 * <VisionProvider baseUrl="/api/vision" headers={() => ({ authorization: `Bearer ${token}` })}>
 *   <App />
 * </VisionProvider>
 * ```
 *
 * `baseUrl` points at **your** server, not at `api.visionapi.io` — an API key is a live
 * spending credential and must never reach a browser. Pass `headers` as a function when the
 * value changes (a rotating session token); it is read at request time, not at render time.
 *
 * The provider is optional: every hook takes the same options directly, which is handy for
 * one-off usage or a Storybook story.
 */
export function VisionProvider({ children, ...options }: VisionProviderProps) {
  const value = useMemo<VisionClientOptions>(
    () => ({
      baseUrl: options.baseUrl,
      headers: options.headers,
      credentials: options.credentials,
      fetch: options.fetch,
    }),
    [options.baseUrl, options.headers, options.credentials, options.fetch],
  );

  return createElement(VisionContext.Provider, { value }, children);
}

/**
 * The options a hook should use: what was passed to the hook, falling back to the provider,
 * falling back to the defaults.
 */
export function useVisionOptions(overrides?: VisionClientOptions): VisionClientOptions {
  const fromContext = useContext(VisionContext);
  return useMemo(
    () => ({ ...(fromContext ?? {}), ...(overrides ?? {}) }),
    [fromContext, overrides?.baseUrl, overrides?.headers, overrides?.credentials, overrides?.fetch],
  );
}
