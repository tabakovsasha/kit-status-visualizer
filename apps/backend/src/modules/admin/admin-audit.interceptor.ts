import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { AdminService } from './admin.service';

type RequestUser = {
  userId: string;
  login: string;
  role: UserRole;
};

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly adminService: AdminService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;

    if (!user || user.role !== UserRole.ADMIN) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          if (
            req.method === 'GET' &&
            !this.isAdminRoute(req.path ?? req.originalUrl ?? '')
          ) {
            return;
          }

          const requestBody = this.toRecord(req.body);
          const action = this.resolveAction(
            req.method,
            req.path ?? req.originalUrl ?? '',
            requestBody,
          );
          const targetUserLogin = this.resolveTargetUserLogin(
            requestBody,
            responseBody,
          );
          const details = this.prepareDetails(requestBody, responseBody);

          void this.adminService.createAuditLog({
            adminId: user.userId,
            adminLogin: user.login,
            action,
            targetUserLogin,
            details,
            ipAddress: typeof req.ip === 'string' ? req.ip : null,
          });
        },
      }),
    );
  }

  private isAdminRoute(path: string): boolean {
    return path.startsWith('/api/admin');
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    return { ...(value as Record<string, unknown>) };
  }

  private resolveAction(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): string {
    if (method === 'POST' && path === '/api/admin/users') {
      return 'USER_CREATE';
    }

    if (method === 'PATCH' && path.startsWith('/api/admin/users/')) {
      if (typeof body.password === 'string' && Object.keys(body).length === 1) {
        return 'USER_RESET_PASSWORD';
      }
      if (typeof body.login === 'string') {
        return 'USER_UPDATE_LOGIN';
      }
      return 'USER_UPDATE';
    }

    if (method === 'GET' && path === '/api/admin/audit-logs') {
      return 'AUDIT_LOG_VIEW';
    }

    if (method === 'GET' && path === '/api/admin/users') {
      return 'USER_LIST_VIEW';
    }

    return `${method} ${path}`;
  }

  private resolveTargetUserLogin(
    body: Record<string, unknown>,
    responseBody: unknown,
  ): string | null {
    const responseRecord = this.toRecord(responseBody);

    const requestLogin = typeof body.login === 'string' ? body.login : null;
    const responseLogin =
      typeof responseRecord.login === 'string' ? responseRecord.login : null;

    return requestLogin ?? responseLogin;
  }

  private prepareDetails(
    body: Record<string, unknown>,
    responseBody: unknown,
  ): Record<string, unknown> {
    const safeBody = { ...body };
    if (typeof safeBody.password === 'string') {
      safeBody.password = '[REDACTED]';
    }

    return {
      request: safeBody,
      response: this.sanitizeResponse(responseBody),
    };
  }

  private sanitizeResponse(responseBody: unknown): unknown {
    const record = this.toRecord(responseBody);
    if (Object.keys(record).length === 0) {
      return responseBody;
    }

    if (typeof record.password === 'string') {
      record.password = '[REDACTED]';
    }
    if (typeof record.passwordHash === 'string') {
      record.passwordHash = '[REDACTED]';
    }

    return record;
  }
}
