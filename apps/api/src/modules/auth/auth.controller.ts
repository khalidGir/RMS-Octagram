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
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- LoginDto uses class-validator decorators
import { LoginDto } from './dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff login' })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email || !body.password) {
      throw new BadRequestException('Email and password are required');
    }
    const tokens = await this.authService.login(body.email, body.password);

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { data: { accessToken: tokens.accessToken } };
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
      return res
        .status(401)
        .json({ error: { code: 'MISSING_REFRESH_TOKEN', message: 'No refresh token' } });
    }

    const tokens = await this.authService.refresh(refreshToken);

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { data: { accessToken: tokens.accessToken } };
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
