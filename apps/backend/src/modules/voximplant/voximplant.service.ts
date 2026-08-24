import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { VoximplantApiService } from './voximplant-api.service';

@Injectable()
export class VoximplantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly apiService: VoximplantApiService,
  ) {}

  async getCredentials(ownerUserId: string) {
    const record = await this.prisma.voximplantCredential.findFirst({
      where: { ownerUserId, deletedAt: null },
      include: { accountInfo: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!record) {
      return {
        tokenConfigured: false,
        accountInfo: null,
      };
    }

    const accountInfo = record.accountInfo
      ? {
          id:
            record.accountInfo.accountId ?? record.accountInfo.domainId ?? null,
          name: record.accountInfo.accountName ?? record.domain,
          mediaServerRegions: record.accountInfo.mediaServerRegions ?? [],
          lastCheckedAt: record.accountInfo.lastCheckedAt,
        }
      : null;

    return {
      domain: record.domain,
      host: record.host,
      tokenConfigured: true,
      accessTokenMasked: '••••••••••••',
      lastVerifiedAt: record.lastVerifiedAt,
      accountInfo,
    };
  }

  async upsertCredentials(
    ownerUserId: string,
    domain: string,
    host: string,
    accessToken?: string,
  ) {
    const current = await this.prisma.voximplantCredential.findFirst({
      where: { ownerUserId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    let encrypted = null;
    if (accessToken && accessToken.trim().length > 0) {
      encrypted = this.encryptionService.encrypt(accessToken);
    }

    const nextValues = {
      domain,
      host,
      tokenCiphertext: encrypted?.ciphertext ?? current?.tokenCiphertext ?? '',
      tokenIv: encrypted?.iv ?? current?.tokenIv ?? '',
      tokenAuthTag: encrypted?.authTag ?? current?.tokenAuthTag ?? '',
      keyVersion: encrypted?.keyVersion ?? current?.keyVersion ?? 1,
    };

    if (current) {
      return this.prisma.voximplantCredential.update({
        where: { id: current.id },
        data: nextValues,
      });
    }

    return this.prisma.voximplantCredential.create({
      data: {
        ownerUserId,
        ...nextValues,
      },
    });
  }

  async decryptAccessToken(ownerUserId: string) {
    const record = await this.prisma.voximplantCredential.findFirst({
      where: { ownerUserId, deletedAt: null },
      include: { accountInfo: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!record) {
      return null;
    }

    return this.encryptionService.decrypt({
      ciphertext: record.tokenCiphertext,
      iv: record.tokenIv,
      authTag: record.tokenAuthTag,
    });
  }

  async testAndPersist(
    ownerUserId: string,
    domain: string,
    host: string,
    accessToken?: string,
  ) {
    const token =
      accessToken?.trim() || (await this.decryptAccessToken(ownerUserId));
    if (!token) {
      throw new BadRequestException('Access token is required');
    }

    const account = await this.apiService.getAccountInfo(domain, host, token);

    const credential = await this.upsertCredentials(
      ownerUserId,
      domain,
      host,
      accessToken?.trim() || undefined,
    );

    await this.prisma.voximplantCredential.update({
      where: { id: credential.id },
      data: { lastVerifiedAt: new Date() },
    });

    await this.prisma.voximplantAccountInfo.upsert({
      where: { credentialId: credential.id },
      update: {
        ownerUserId,
        accountId: account.account_id ?? null,
        domainId: account.id ?? null,
        accountName: account.name ?? null,
        mediaServerRegions: account.partner?.media_servers_regions ?? [],
        lastCheckedAt: new Date(),
      },
      create: {
        ownerUserId,
        credentialId: credential.id,
        accountId: account.account_id ?? null,
        domainId: account.id ?? null,
        accountName: account.name ?? null,
        mediaServerRegions: account.partner?.media_servers_regions ?? [],
        lastCheckedAt: new Date(),
      },
    });

    return {
      tokenConfigured: true,
      accessTokenMasked: '••••••••••••',
      lastVerifiedAt: new Date().toISOString(),
      accountInfo: {
        id: account.id,
        name: account.name,
        mediaServerRegions: account.partner?.media_servers_regions ?? [],
      },
    };
  }
}
