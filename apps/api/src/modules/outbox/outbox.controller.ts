import { Controller, Get, Post, Param, Body, UseGuards, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/types';
import { TenantRole } from '@rms/contracts';
import { OutboxProcessor } from './outbox.processor';

@ApiTags('Outbox')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('outbox')
export class OutboxController {
  constructor(@Inject(OutboxProcessor) private readonly processor: OutboxProcessor) {}

  @Get('stats')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Get outbox event statistics by status' })
  async getStats() {
    const stats = await this.processor.getStats();
    return { data: stats };
  }

  @Get('dead-letter')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'List dead-letter events' })
  async getDeadLetter() {
    const events = await this.processor.getDeadLetterEvents();
    return { data: events };
  }

  @Post('retry/:eventId')
  @Roles(TenantRole.OWNER)
  @ApiOperation({ summary: 'Manually retry a dead-letter event' })
  async retryDeadLetter(
    @Param('eventId') eventId: string,
    @Body() body: { actorUserId: string },
  ) {
    await this.processor.retryDeadLetter(eventId, body.actorUserId);
    return { data: { success: true, eventId } };
  }
}
