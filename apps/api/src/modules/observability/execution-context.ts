import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Execution context for HTTP requests and background jobs.
 * Uses AsyncLocalStorage to propagate correlation ID through the call stack.
 */
export class ExecutionContext {
  static run<T>(context: RequestContext, fn: () => T): T {
    return asyncLocalStorage.run(context, fn);
  }

  static getContext(): RequestContext | undefined {
    return asyncLocalStorage.getStore();
  }

  static getCorrelationId(): string {
    return asyncLocalStorage.getStore()?.correlationId ?? 'unknown';
  }

  static getTenantId(): string | undefined {
    return asyncLocalStorage.getStore()?.tenantId;
  }

  static getUserId(): string | undefined {
    return asyncLocalStorage.getStore()?.userId;
  }
}
