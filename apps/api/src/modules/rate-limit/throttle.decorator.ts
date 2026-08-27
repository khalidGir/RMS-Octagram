import { SetMetadata } from '@nestjs/common';
import type { ThrottleOptions } from './throttle-options.interface';

export type { ThrottleOptions } from './throttle-options.interface';
export const THROTTLE_OPTIONS_KEY = 'throttle_options';

/**
 * Decorator to configure rate limiting for a route or controller.
 * @example @Throttle({ ttl: 60000, limit: 10, name: 'login' })
 */
export const Throttle = (options: ThrottleOptions) => SetMetadata(THROTTLE_OPTIONS_KEY, options);
