import { Module, type NestModule, type MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { PlatformAdminModule } from './modules/platform/platform-admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { TablesModule } from './modules/tables/tables.module';
import { PublicMenuModule } from './modules/public-menu/public-menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { KitchenModule } from './modules/kitchen/kitchen.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { FeaturesModule } from './modules/features/features.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CorrelationMiddleware } from './modules/observability/correlation.middleware';
import { HttpLoggerMiddleware } from './modules/observability/http-logger.middleware';
import { TenantContextMiddleware } from './modules/auth/tenant-context.middleware';
import { JwtStrategy } from './modules/auth/jwt.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    PrismaModule,
    HealthModule,
    AuthModule,
    TenancyModule,
    PlatformAdminModule,
    AuditModule,
    ObservabilityModule,
    CatalogModule,
    TablesModule,
    PublicMenuModule,
    OrdersModule,
    PaymentsModule,
    KitchenModule,
    InventoryModule,
    OutboxModule,
    FeaturesModule,
    AnalyticsModule,
  ],
  providers: [JwtStrategy, TenantContextMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(cookieParser()).forRoutes('*');
    consumer.apply(CorrelationMiddleware, HttpLoggerMiddleware).forRoutes('*');
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
