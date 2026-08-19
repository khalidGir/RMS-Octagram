import { Module, type NestModule, type MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { PlatformAdminModule } from './modules/platform/platform-admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { ObservabilityModule } from './modules/observability/observability.module';
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
  ],
  providers: [JwtStrategy],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware, HttpLoggerMiddleware).forRoutes('*');
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
