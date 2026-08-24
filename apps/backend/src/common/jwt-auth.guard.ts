import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { verify } from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token');
    }

    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = verify(token, process.env.JWT_ACCESS_SECRET ?? '') as {
        sub: string;
        login?: string;
      };

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          login: true,
          role: true,
          isActive: true,
          mustChangePassword: true,
        },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User is inactive');
      }

      const path = String(req.path ?? req.originalUrl ?? '');
      const isAllowedDuringFirstLogin =
        req.method === 'POST' &&
        (path === '/api/auth/change-first-password' ||
          path === '/api/auth/logout');

      if (user.mustChangePassword && !isAllowedDuringFirstLogin) {
        throw new ForbiddenException('MUST_CHANGE_PASSWORD');
      }

      req.user = {
        userId: user.id,
        login: user.login,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      };
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
