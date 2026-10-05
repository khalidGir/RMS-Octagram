/**
 * Options for the @Throttle decorator.
 */
export interface ThrottleOptions {
  /** Name of the throttle (used as key prefix) */
  name: string;
  /** Time window in milliseconds */
  ttl: number;
  /** Maximum number of requests within the time window */
  limit: number;
  /** Block duration in milliseconds (optional, defaults to ttl) */
  blockDuration?: number;
  /** Custom key prefix (optional, defaults to name) */
  keyPrefix?: string;
}
