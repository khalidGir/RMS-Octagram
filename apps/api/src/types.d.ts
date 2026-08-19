import type { TenantContext } from './modules/auth/types';

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}
