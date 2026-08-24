import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './common/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { VoximplantModule } from './modules/voximplant/voximplant.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OperatorSelectionsModule } from './modules/operator-selections/operator-selections.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { AdminModule } from './modules/admin/admin.module';
import { BootstrapService } from './bootstrap.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAuditInterceptor } from './modules/admin/admin-audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    VoximplantModule,
    CatalogModule,
    OperatorSelectionsModule,
    TimelineModule,
    PreferencesModule,
    AdminModule,
  ],
  providers: [
    BootstrapService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminAuditInterceptor,
    },
  ],
})
export class AppModule {}
