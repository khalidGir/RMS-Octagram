import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI requires value import for decorator metadata
import { PublicMenuService } from './public-menu.service';

class ResolveTableContextDto {
  @ApiProperty({ description: 'QR token from printed label' })
  @IsString()
  token!: string;
}

@ApiTags('Public Menu')
@Controller('public')
export class PublicMenuController {
  constructor(private readonly publicMenu: PublicMenuService) {}

  @Get('tenants/:tenantId/branches/:branchId/menu')
  @ApiOperation({ summary: 'Get branch menu (public, unauthenticated)' })
  async getMenu(@Param('tenantId') tenantId: string, @Param('branchId') branchId: string) {
    return { data: await this.publicMenu.getBranchMenu(branchId, tenantId) };
  }

  @Post('tenants/:tenantId/table-context')
  @ApiOperation({ summary: 'Resolve table context from QR token (public, unauthenticated)' })
  async getTableContext(@Param('tenantId') tenantId: string, @Body() body: ResolveTableContextDto) {
    return { data: await this.publicMenu.resolveTableContext(body.token, tenantId) };
  }
}
