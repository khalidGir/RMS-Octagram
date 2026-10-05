import { Injectable, ForbiddenException } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

const CSRF_TOKEN_COOKIE = '_csrf';
const CSRF_TOKEN_HEADER = 'x-csrf-token';
const CSRF_SECRET_LENGTH = 32;

/**
 * CSRF protection for cookie-authenticated endpoints only.
 * Bearer-token API requests are NOT vulnerable to CSRF.
 *
 * Uses cryptographically random double-submit token with constant-time comparison.
 * Applied only to: POST /auth/refresh, POST /auth/logout
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    // Only apply to state-changing methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    // Check if this request uses cookie authentication
    const hasRefreshCookie = req.cookies?.refresh_token;
    if (!hasRefreshCookie) {
      // No cookie = bearer token request = not CSRF-vulnerable
      return next();
    }

    // Validate CSRF token
    const cookieToken = req.cookies?.[CSRF_TOKEN_COOKIE];
    const headerToken = req.headers[CSRF_TOKEN_HEADER] as string;

    // Double-submit: only enforce when the _csrf cookie was set (i.e., client went through login/refresh).
    // If neither cookie nor header exists, pass through for backward compatibility.
    if (!cookieToken && !headerToken) {
      return next();
    }

    if (!cookieToken || !headerToken) {
      throw new ForbiddenException('CSRF token missing');
    }

    // Constant-time comparison
    try {
      const cookieBuf = Buffer.from(cookieToken, 'hex');
      const headerBuf = Buffer.from(headerToken, 'hex');

      if (cookieBuf.length !== headerBuf.length) {
        throw new ForbiddenException('CSRF token invalid');
      }

      if (!timingSafeEqual(cookieBuf, headerBuf)) {
        throw new ForbiddenException('CSRF token invalid');
      }
    } catch {
      throw new ForbiddenException('CSRF token invalid');
    }

    next();
  }

  /**
   * Generate and set a new CSRF token on the response.
   * Call this after successful login/refresh.
   */
  static generateToken(res: Response): string {
    const token = randomBytes(CSRF_SECRET_LENGTH).toString('hex');
    res.cookie(CSRF_TOKEN_COOKIE, token, {
      httpOnly: false, // JavaScript needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none' || 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return token;
  }
}
