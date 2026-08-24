import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { randomUUID, createHash } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async login(
    login: string,
    password: string,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2
      .verify(user.passwordHash, password)
      .catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwt.sign({
      sub: user.id,
      login: user.login,
      role: user.role,
    });
    const refreshPlain = randomUUID() + randomUUID();
    const refreshTokenHash = this.hashRefreshToken(refreshPlain);

    await this.prisma.$transaction([
      this.prisma.userSession.create({
        data: {
          ownerUserId: user.id,
          refreshTokenHash,
          userAgent,
          ipAddress,
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    return {
      accessToken,
      refreshToken: refreshPlain,
      user: {
        id: user.id,
        login: user.login,
        role: user.role,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async refresh(refreshToken: string) {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const session = await this.prisma.userSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
      },
      include: { user: true },
    });

    if (!session || !session.user.isActive) {
      throw new UnauthorizedException('Invalid session');
    }

    const newRefresh = randomUUID() + randomUUID();
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.hashRefreshToken(newRefresh),
      },
    });

    const accessToken = this.jwt.sign({
      sub: session.user.id,
      login: session.user.login,
      role: session.user.role,
    });

    return {
      accessToken,
      refreshToken: newRefresh,
      user: {
        id: session.user.id,
        login: session.user.login,
        role: session.user.role,
        isActive: session.user.isActive,
        mustChangePassword: session.user.mustChangePassword,
      },
    };
  }

  async changeFirstPassword(userId: string, password: string) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
      select: {
        id: true,
        login: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
      },
    });

    return user;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid user');
    }

    const isCurrentPasswordValid = await argon2
      .verify(user.passwordHash, currentPassword)
      .catch(() => false);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is invalid');
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      }),
      this.prisma.userSession.updateMany({
        where: { ownerUserId: userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  async logout(refreshToken: string) {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    await this.prisma.userSession.updateMany({
      where: { refreshTokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.userSession.updateMany({
      where: { ownerUserId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
