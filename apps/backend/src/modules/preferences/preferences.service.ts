import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(ownerUserId: string) {
    const all = await this.prisma.userPreference.findMany({
      where: { ownerUserId },
    });
    return Object.fromEntries(all.map((item) => [item.key, item.value]));
  }

  async put(ownerUserId: string, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      await this.prisma.userPreference.upsert({
        where: { ownerUserId_key: { ownerUserId, key } },
        update: { value: value as any },
        create: { ownerUserId, key, value: value as any },
      });
    }
    return this.get(ownerUserId);
  }
}
