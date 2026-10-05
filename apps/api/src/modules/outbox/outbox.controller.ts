import { Controller, Get, Post, Param, Req, UseGuards, Inject, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, type TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
import { OutboxProcessor, type OutboxScope } from './outbox.processor';

@ApiTags('Outbox')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('outbox')
export class OutboxController {
  constructor(@Inject(OutboxProcessor) private readonly processor: OutboxProcessor) {}

  @Get('stats')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Get outbox event statistics by status' })
  async getStats(@Req() request: Request) {
    const stats = await this.processor.getStats(this.scope(request));
    return { data: stats };
  }

  @Get('dead-letter')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'List dead-letter events' })
  async getDeadLetter(@Req() request: Request) {
    const events = await this.processor.getDeadLetterEvents(this.scope(request));
    return { data: events };
  }

  @Post('retry/:eventId')
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Manually retry a dead-letter event' })
  async retryDeadLetter(
    @Param('eventId') eventId: string,
    @Req() request: Request,
  ) {
    const scope = this.scope(request);
    const context = request.tenantContext as TenantContext;
    await this.processor.retryDeadLetter(scope, eventId, context.userId);
    return { data: { success: true, eventId } };
  }

  private scope(request: Request): OutboxScope {
    const context = request.tenantContext as TenantContext | undefined;
    if (!context?.tenantId || !context.userId || ![TenantRole.OWNER, TenantRole.MANAGER].includes(context.tenantRole!)) {
      throw new ForbiddenException('An authorized restaurant context is required');
    }
    return {
      tenantId: context.tenantId,
      ...(context.tenantRole === TenantRole.OWNER ? {} : { branchIds: context.branchIds ?? [] }),
    };
  }
}
