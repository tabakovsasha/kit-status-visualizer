import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class OperatorSelectionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(ownerUserId: string) {
    return this.prisma.savedOperatorSelection.findMany({
      where: { ownerUserId },
      include: { items: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  create(ownerUserId: string, name: string, operatorIds: number[]) {
    const unique = [...new Set(operatorIds)];
    return this.prisma.savedOperatorSelection.create({
      data: {
        ownerUserId,
        name,
        items: {
          createMany: {
            data: unique.map((operatorId) => ({ ownerUserId, operatorId })),
          },
        },
      },
      include: { items: true },
    });
  }

  async update(
    ownerUserId: string,
    id: string,
    name: string,
    operatorIds: number[],
  ) {
    const existing = await this.prisma.savedOperatorSelection.findFirst({
      where: { id, ownerUserId },
    });
    if (!existing) {
      throw new NotFoundException('Selection not found');
    }

    const unique = [...new Set(operatorIds)];
    await this.prisma.savedOperatorSelectionItem.deleteMany({
      where: { selectionId: id, ownerUserId },
    });
    return this.prisma.savedOperatorSelection.update({
      where: { id },
      data: {
        name,
        items: {
          createMany: {
            data: unique.map((operatorId) => ({ ownerUserId, operatorId })),
          },
        },
      },
      include: { items: true },
    });
  }

  async remove(ownerUserId: string, id: string) {
    const existing = await this.prisma.savedOperatorSelection.findFirst({
      where: { id, ownerUserId },
    });
    if (!existing) {
      throw new NotFoundException('Selection not found');
    }
    await this.prisma.savedOperatorSelection.delete({ where: { id } });
    return { success: true };
  }
}
