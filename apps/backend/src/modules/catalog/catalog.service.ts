import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { VoximplantService } from '../voximplant/voximplant.service';
import { VoximplantApiService } from '../voximplant/voximplant-api.service';

@Injectable()
export class CatalogService {
  private readonly statusTypesTtlMs = 12 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsService: VoximplantService,
    private readonly api: VoximplantApiService,
  ) {}

  private async refreshStatusTypes(ownerUserId: string) {
    const { credentials, token, accountKey } =
      await this.resolveAuth(ownerUserId);
    const statusTypes = await this.api.searchTypeStatuses(
      credentials.domain,
      credentials.host,
      token,
    );

    const refreshedAt = new Date();

    await this.prisma.statusTypeSnapshot.deleteMany({
      where: { ownerUserId, accountKey },
    });

    if (statusTypes.length > 0) {
      await this.prisma.statusTypeSnapshot.createMany({
        data: statusTypes.map((item) => ({
          ownerUserId,
          accountKey,
          statusKey: item.key,
          title: item.title,
          color: item.color,
          description: item.description,
          payload: item,
          refreshedAt,
        })),
      });
    }

    return this.prisma.statusTypeSnapshot.findMany({
      where: { ownerUserId, accountKey },
      orderBy: { statusKey: 'asc' },
    });
  }

  private async resolveAuth(ownerUserId: string) {
    const credentials = await this.prisma.voximplantCredential.findFirst({
      where: { ownerUserId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    if (!credentials) {
      throw new BadRequestException(
        'Voximplant credentials are not configured',
      );
    }

    const token = await this.credentialsService.decryptAccessToken(ownerUserId);
    if (!token) {
      throw new BadRequestException('Voximplant token is not configured');
    }

    const accountKey = `${credentials.domain}@${credentials.host}`;

    return {
      credentials,
      token,
      accountKey,
    };
  }

  async refresh(ownerUserId: string) {
    const { credentials, token, accountKey } =
      await this.resolveAuth(ownerUserId);

    const [users, groups, queues, statusTypes] = await Promise.all([
      this.api.searchUsers(credentials.domain, credentials.host, token),
      this.api.searchGroups(credentials.domain, credentials.host, token),
      this.api.searchQueues(credentials.domain, credentials.host, token),
      this.api.searchTypeStatuses(credentials.domain, credentials.host, token),
    ]);

    const refreshedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.operatorSnapshot.deleteMany({
        where: { ownerUserId, accountKey },
      }),
      this.prisma.groupSnapshot.deleteMany({
        where: { ownerUserId, accountKey },
      }),
      this.prisma.queueSnapshot.deleteMany({
        where: { ownerUserId, accountKey },
      }),
      this.prisma.statusTypeSnapshot.deleteMany({
        where: { ownerUserId, accountKey },
      }),
    ]);

    await this.prisma.operatorSnapshot.createMany({
      data: users.map((u) => ({
        ownerUserId,
        accountKey,
        operatorId: u.id,
        fullName: u.full_name,
        timezone: u.profile?.utc ?? null,
        payload: u,
        refreshedAt,
      })),
    });

    await this.prisma.groupSnapshot.createMany({
      data: groups.map((g) => ({
        ownerUserId,
        accountKey,
        groupId: g.id,
        groupTitle: g.group_title,
        payload: g,
        refreshedAt,
      })),
    });

    await this.prisma.queueSnapshot.createMany({
      data: queues.map((q) => ({
        ownerUserId,
        accountKey,
        queueId: q.id,
        queueTitle: q.acd_queue_title,
        payload: q,
        refreshedAt,
      })),
    });

    await this.prisma.statusTypeSnapshot.createMany({
      data: statusTypes.map((s) => ({
        ownerUserId,
        accountKey,
        statusKey: s.key,
        title: s.title,
        color: s.color,
        description: s.description,
        payload: s,
        refreshedAt,
      })),
    });

    return {
      refreshedAt,
      counts: {
        users: users.length,
        groups: groups.length,
        queues: queues.length,
        statusTypes: statusTypes.length,
      },
    };
  }

  async getQueues(ownerUserId: string) {
    return this.prisma.queueSnapshot.findMany({
      where: { ownerUserId },
      orderBy: { queueTitle: 'asc' },
    });
  }

  async getGroups(ownerUserId: string) {
    return this.prisma.groupSnapshot.findMany({
      where: { ownerUserId },
      orderBy: { groupTitle: 'asc' },
    });
  }

  async getOperators(ownerUserId: string) {
    return this.prisma.operatorSnapshot.findMany({
      where: { ownerUserId },
      orderBy: { fullName: 'asc' },
    });
  }

  async getStatusTypes(ownerUserId: string) {
    const existing = await this.prisma.statusTypeSnapshot.findMany({
      where: { ownerUserId },
      orderBy: [{ refreshedAt: 'desc' }, { statusKey: 'asc' }],
    });

    if (existing.length === 0) {
      return this.refreshStatusTypes(ownerUserId).catch(() => []);
    }

    const freshestMs = new Date(existing[0].refreshedAt).getTime();
    if (Date.now() - freshestMs > this.statusTypesTtlMs) {
      return this.refreshStatusTypes(ownerUserId).catch(() => existing);
    }

    return existing;
  }
}
