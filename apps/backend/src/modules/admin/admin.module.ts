import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';
import { RolesGuard } from '../../common/roles.guard';
import { AdminAuditInterceptor } from './admin-audit.interceptor';

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService, RolesGuard, AdminAuditInterceptor],
  exports: [AdminService],
})
export class AdminModule {}
