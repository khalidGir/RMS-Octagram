import { SetMetadata } from '@nestjs/common';
import type { TenantRole, PlatformRole } from '@rms/contracts';

export interface TenantContext {
  userId: string;
  email: string | null;
  platformRole: string | null;
  tenantId?: string;
  tenantRole?: TenantRole;
  branchIds?: string[];
}

export const TENANT_CONTEXT_KEY = 'tenantContext';
export const TENANT_CONTEXT = (ctx: TenantContext) => SetMetadata(TENANT_CONTEXT_KEY, ctx);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: (TenantRole | PlatformRole)[]) => SetMetadata(ROLES_KEY, roles);

export const BRANCH_SCOPED_KEY = 'branchScoped';
export const BranchScoped = () => SetMetadata(BRANCH_SCOPED_KEY, true);

export const TENANT_SCOPED_KEY = 'tenantScoped';
export const TenantScoped = () => SetMetadata(TENANT_SCOPED_KEY, true);
