import {
  Body,
  Controller,
  Get,
  Query,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';

class CreateAdminUserDto {
  @IsString()
  @MinLength(3)
  login!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}

class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  login?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class AuditLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

@Controller('api/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly adminService: AdminService,
  ) {}

  @Get('users')
  async listUsers() {
    return this.usersService.listUsers();
  }

  @Post('users')
  async createUser(@Body() dto: CreateAdminUserDto) {
    return this.usersService.createUser(
      dto.login,
      dto.password,
      dto.role,
      true,
    );
  }

  @Patch('users/:id')
  async patchUser(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.usersService.updateUser(id, {
      login: dto.login,
      password: dto.password,
      role: dto.role,
      isActive: dto.isActive,
    });
  }

  @Get('audit-logs')
  async listAuditLogs(@Query() query: AuditLogsQueryDto) {
    return this.adminService.listAuditLogs({
      page: query.page ?? 1,
      limit: Math.min(query.limit ?? 25, 100),
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
