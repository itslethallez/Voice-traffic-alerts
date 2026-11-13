import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Minimal structural stand-ins for @vercel/node's VercelRequest /
 * VercelResponse. That package was only ever imported for these types -
 * nothing from it shipped in the function bundle - but it dragged in
 * flagged transitive deps (undici, path-to-regexp, ajv, node-tar via
 * @mapbox/node-pre-gyp). The surface below is everything the handlers
 * use and matches what Vercel's runtime actually passes to a Node
 * function: IncomingMessage/ServerResponse plus the helper methods.
 */
export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
  cookies?: Record<string, string>;
}

export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
  send(body: unknown): VercelResponse;
  redirect(statusOrUrl: number | string, url?: string): VercelResponse;
}
