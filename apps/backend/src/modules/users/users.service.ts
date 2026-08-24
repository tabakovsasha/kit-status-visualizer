import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { UserRole } from '@prisma/client';
import argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrapFromEnv() {
    if (!process.env.DATABASE_URL) {
      return;
    }

    const usersCount = await this.prisma.user.count();
    if (usersCount > 0) {
      return;
    }

    const login =
      process.env.INIT_ADMIN_LOGIN ?? process.env.BOOTSTRAP_USER_LOGIN;
    const password =
      process.env.INIT_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_USER_PASSWORD;

    if (!login || !password) {
      return;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await this.prisma.user.create({
      data: {
        login,
        passwordHash,
        isActive: true,
        role: UserRole.ADMIN,
        mustChangePassword: true,
      },
    });
  }

  async createUser(
    login: string,
    password: string,
    role: UserRole,
    active = true,
  ) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    return this.prisma.user.create({
      data: {
        login,
        passwordHash,
        role,
        isActive: active,
        mustChangePassword: false,
      },
      select: {
        id: true,
        login: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        login: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUser(
    userId: string,
    payload: {
      login?: string;
      role?: UserRole;
      isActive?: boolean;
      password?: string;
    },
  ) {
    const data: {
      login?: string;
      role?: UserRole;
      isActive?: boolean;
      passwordHash?: string;
    } = {};

    if (payload.login !== undefined) {
      data.login = payload.login;
    }
    if (payload.role !== undefined) {
      data.role = payload.role;
    }
    if (payload.isActive !== undefined) {
      data.isActive = payload.isActive;
    }
    if (payload.password !== undefined) {
      data.passwordHash = await argon2.hash(payload.password, {
        type: argon2.argon2id,
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        login: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (payload.password !== undefined) {
      await this.prisma.userSession.updateMany({
        where: { ownerUserId: userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return updated;
  }

  async updateStatus(userId: string, isActive: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        login: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
      },
    });
  }

  async changePassword(userId: string, password: string) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.prisma.userSession.updateMany({
      where: { ownerUserId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
