import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Inject,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantRole } from '@rms/contracts';
import { TenancyService } from './tenancy.service';
import { BrandingService } from './branding.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, type TenantContext } from '../auth/types';
import { Throttle } from '../rate-limit/throttle.decorator';
import type {
  UpdateTenantDto,
  CreateBranchDto,
  UpdateBranchDto,
  InviteMemberDto,
  UpdateMembershipDto,
  ReplaceBranchAssignmentsDto,
  SetFeatureDto,
} from './dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- logo DTOs must be runtime values: Nest ValidationPipe reads design:paramtypes, and a type-only import compiles to Object, silently skipping validation
import { CreateLogoUploadDto, FinalizeLogoDto, RemoveLogoDto } from './dto';

@ApiTags('Tenancy')
@Controller()
export class TenancyController {
  constructor(
    @Inject(TenancyService) private readonly tenancyService: TenancyService,
    @Inject(BrandingService) private readonly branding: BrandingService,
  ) {}

  @Get('tenants/current')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Current tenant profile' })
  async getCurrentTenant(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    if (!ctx?.tenantId) {
      return { data: null };
    }
    const tenant = await this.tenancyService.getTenant(ctx.tenantId);
    return { data: tenant };
  }

  @Patch('tenants/current')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Update tenant settings' })
  async updateTenant(@Req() req: Request, @Body() body: UpdateTenantDto) {
    const ctx = req.tenantContext as TenantContext;
    const tenant = await this.tenancyService.updateTenant(ctx.tenantId!, body);
    return { data: tenant };
  }

  @Post('tenants/current/logo/upload-intent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER)
  @ApiCookieAuth()
  @Throttle({ ttl: 60_000, limit: 10, name: 'logo-upload' })
  @ApiOperation({ summary: 'Create a restaurant logo upload intent (owner only)' })
  async createLogoUploadIntent(@Req() req: Request, @Body() body: CreateLogoUploadDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.branding.createUploadIntent(ctx.tenantId!, ctx.userId, body) };
  }

  @Post('tenants/current/logo/finalize')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Verify and queue a restaurant logo for processing (owner only)' })
  async finalizeLogo(@Req() req: Request, @Body() body: FinalizeLogoDto) {
    const ctx = req.tenantContext as TenantContext;
    return {
      data: await this.branding.finalize(
        ctx.tenantId!,
        ctx.userId,
        body.mediaObjectId,
        body.expectedVersion,
      ),
    };
  }

  @Get('tenants/current/logo/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Restaurant logo processing status (owner only)' })
  async logoStatus(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const mediaObjectId = (req.query.mediaObjectId as string) || undefined;
    return { data: await this.branding.status(ctx.tenantId!, mediaObjectId) };
  }

  @Delete('tenants/current/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Remove the restaurant logo (owner only)' })
  async removeLogo(@Req() req: Request, @Body() body: RemoveLogoDto) {
    const ctx = req.tenantContext as TenantContext;
    return { data: await this.branding.remove(ctx.tenantId!, ctx.userId, body.expectedVersion) };
  }

  @Get('branches')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List authorized branches' })
  async listBranches(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    if (!ctx?.tenantId) return { data: [] };

    const branches = await this.tenancyService.listBranches(ctx.tenantId);

    if (ctx.tenantRole !== TenantRole.OWNER && ctx.branchIds) {
      return { data: branches.filter((b) => ctx.branchIds!.includes(b.id)) };
    }

    return { data: branches };
  }

  @Post('branches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Create branch' })
  async createBranch(@Req() req: Request, @Body() body: CreateBranchDto) {
    const ctx = req.tenantContext as TenantContext;
    const branch = await this.tenancyService.createBranch(ctx.tenantId!, body);
    return { data: branch };
  }

  @Patch('branches/:branchId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Update branch' })
  async updateBranch(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() body: UpdateBranchDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const branch = await this.tenancyService.updateBranch(
      branchId,
      ctx.tenantId!,
      body,
      ctx.tenantRole,
      ctx.branchIds,
    );
    return { data: branch };
  }

  @Get('memberships')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List scoped staff' })
  async listMemberships(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const memberships = await this.tenancyService.listMemberships(ctx.tenantId!);
    return { data: memberships };
  }

  @Post('memberships/invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Invite staff' })
  async inviteMember(@Req() req: Request, @Body() body: InviteMemberDto) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.tenancyService.inviteMember(ctx.tenantId!, {
      phone: body.phone,
      role: body.role as TenantRole,
      branchIds: body.branchIds,
      invitedByUserId: ctx.userId,
      callerRole: ctx.tenantRole!,
      callerBranchIds: ctx.branchIds,
    });
    return { data: result };
  }

  @Post('memberships/accept-invitation')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Accept invitation' })
  async acceptInvitation(@Req() req: Request, @Body() body: { invitationToken: string }) {
    const ctx = req.tenantContext as TenantContext;
    const membership = await this.tenancyService.acceptInvitation(body.invitationToken, ctx.userId);
    return { data: membership };
  }

  @Patch('memberships/:membershipId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Update membership role/status' })
  async updateMembership(
    @Req() req: Request,
    @Param('membershipId') membershipId: string,
    @Body() body: UpdateMembershipDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const membership = await this.tenancyService.updateMembership(
      membershipId,
      ctx.tenantId!,
      ctx.userId,
      ctx.tenantRole!,
      { role: body.role as TenantRole | undefined, status: body.status },
    );
    return { data: membership };
  }

  @Put('memberships/:membershipId/branches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Replace branch assignments' })
  async replaceBranchAssignments(
    @Req() req: Request,
    @Param('membershipId') membershipId: string,
    @Body() body: ReplaceBranchAssignmentsDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    await this.tenancyService.replaceBranchAssignments(
      membershipId,
      ctx.tenantId!,
      body.branchIds,
      ctx.userId,
      ctx.tenantRole,
      ctx.branchIds,
    );
    return { data: { success: true } };
  }

  @Get('tenants/features')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Get tenant-level feature configuration with entitlement status' })
  async getTenantFeatures(@Req() req: Request) {
    const ctx = req.tenantContext as TenantContext;
    const features = await this.tenancyService.getTenantFeatures(ctx.tenantId!);
    return { data: features };
  }

  @Put('tenants/features/:featureKey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Set tenant-level feature (entitlement-gated)' })
  async setTenantFeature(
    @Req() req: Request,
    @Param('featureKey') featureKey: string,
    @Body() body: SetFeatureDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const feature = await this.tenancyService.setTenantFeature(
      ctx.tenantId!,
      featureKey,
      body.enabled,
      ctx.userId,
    );
    return { data: feature };
  }

  @Get('branches/:branchId/features')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Get effective features for branch' })
  async getFeatures(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const features = await this.tenancyService.getFeatures(ctx.tenantId!, branchId);
    return { data: features };
  }

  @Put('branches/:branchId/features/:featureKey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Set feature override' })
  async setFeature(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('featureKey') featureKey: string,
    @Body() body: SetFeatureDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const feature = await this.tenancyService.setFeature(
      ctx.tenantId!,
      branchId,
      featureKey,
      body.enabled,
      ctx.userId,
      ctx.tenantRole,
      ctx.branchIds,
    );
    return { data: feature };
  }
}
