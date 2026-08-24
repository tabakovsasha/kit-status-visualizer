import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createAuditLog(payload: {
    adminId: string;
    adminLogin: string;
    action: string;
    targetUserLogin?: string | null;
    details?: unknown;
    ipAddress?: string | null;
  }) {
    return this.prisma.auditLog.create({
      data: {
        adminId: payload.adminId,
        adminLogin: payload.adminLogin,
        action: payload.action,
        targetUserLogin: payload.targetUserLogin ?? null,
        details: payload.details as object | undefined,
        ipAddress: payload.ipAddress ?? null,
      },
    });
  }

  async listAuditLogs(params: {
    page: number;
    limit: number;
    from?: Date;
    to?: Date;
  }) {
    const where: {
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {};

    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) {
        where.createdAt.gte = params.from;
      }
      if (params.to) {
        where.createdAt.lte = params.to;
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: {
          id: true,
          adminId: true,
          adminLogin: true,
          action: true,
          targetUserLogin: true,
          details: true,
          ipAddress: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.ceil(total / params.limit),
    };
  }
}
