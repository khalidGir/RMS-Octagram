import {
  Controller,
  Inject,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CsrfMiddleware } from '../../common/middleware/csrf.middleware';
import { Throttle } from '../rate-limit/throttle.decorator';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- LoginDto uses class-validator decorators
import { LoginDto } from './dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private getCookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') || 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      domain: process.env.COOKIE_DOMAIN || undefined,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ ttl: 60_000, limit: 100, name: 'login' })
  @ApiOperation({ summary: 'Staff login' })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email || !body.password) {
      throw new BadRequestException('Email and password are required');
    }
    const tokens = await this.authService.login(body.email, body.password);

    // Set refresh token cookie
    res.cookie('refresh_token', tokens.refreshToken, this.getCookieOptions());

    // Set CSRF token for cookie-authenticated requests
    const csrfToken = CsrfMiddleware.generateToken(res);

    return { data: { accessToken: tokens.accessToken, csrfToken } };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh session' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token as string;
    if (!refreshToken) {
      throw new BadRequestException('No refresh token');
    }

    const tokens = await this.authService.refresh(refreshToken);

    // Set new refresh token cookie
    res.cookie('refresh_token', tokens.refreshToken, this.getCookieOptions());

    // Set new CSRF token
    const csrfToken = CsrfMiddleware.generateToken(res);

    return { data: { accessToken: tokens.accessToken, csrfToken } };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke current session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refresh_token as string;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie('refresh_token', { path: '/' });
    res.clearCookie('_csrf', { path: '/' });
    return { data: { success: true } };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke all sessions for user' })
  async logoutAll(@Req() req: Request) {
    const userId = (req as any).user?.sub as string;
    await this.authService.logoutAll(userId);
    return { data: { success: true } };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Current user profile, memberships, and permissions' })
  async me(@Req() req: Request) {
    const userId = (req as any).user?.sub as string;
    const profile = await this.authService.getProfile(userId);
    return { data: profile };
  }
}
