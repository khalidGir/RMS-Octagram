import { Controller, Post, Body, Inject, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServiceRequestService } from './service-request.service';
import type { ServiceRequestType } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS needs runtime DTO classes for validation metadata.
import { CreateServiceRequestDto, PublicServiceRequestsStatusDto } from './dto';

@ApiTags('Public Service Requests')
@Controller('public')
export class PublicServiceRequestsController {
  constructor(
    @Inject(ServiceRequestService)
    private readonly serviceRequests: ServiceRequestService,
  ) {}

  @Post('service-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a table assistance request from a table QR token' })
  async create(@Body() dto: CreateServiceRequestDto) {
    const result = await this.serviceRequests.createFromToken({
      qrToken: dto.qrToken,
      type: dto.type as ServiceRequestType,
      note: dto.note,
      idempotencyKey: dto.idempotencyKey,
    });
    return {
      data: { request: result.request, created: result.created, alreadyOpen: result.alreadyOpen },
    };
  }

  @Post('service-requests/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active assistance requests for the table behind a QR token' })
  async status(@Body() dto: PublicServiceRequestsStatusDto) {
    const result = await this.serviceRequests.getTableRequests(dto.qrToken);
    return { data: result };
  }
}
