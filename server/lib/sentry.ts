import * as Sentry from '@sentry/node';
import type { VercelRequest, VercelResponse } from './vercel-types';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

let initialised = false;

function initSentry(): void {
  if (initialised) return;
  initialised = true;
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? 'development',
  });
}

/**
 * Wraps a Vercel function handler so an unhandled throw is captured and
 * flushed before rethrowing - the flush matters because a serverless
 * invocation freezes right after responding, which would drop the event.
 * Handlers that catch their own errors (the house style in api/) should
 * call captureException() inside the catch, since their try/catch swallows
 * the error before this wrapper could ever see it.
 */
export function withSentry(handler: Handler): Handler {
  return async (req, res) => {
    initSentry();
    try {
      await handler(req, res);
    } catch (error) {
      Sentry.captureException(error);
      await Sentry.flush(2000);
      throw error;
    }
  };
}

/** For use inside a handler's own catch block - see withSentry's comment. */
export function captureException(error: unknown): void {
  initSentry();
  Sentry.captureException(error);
}
