import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { isIP } from 'net';
import { lookup } from 'dns/promises';

type VoxResponse<T> = {
  success?: boolean;
  result?: T;
  _meta?: {
    totalCount?: number;
    pageCount?: number;
    currentPage?: number;
    perPage?: number;
  };
};

@Injectable()
export class VoximplantApiService {
  private normalizeHost(host: string): string {
    const trimmed = host.trim();
    const normalized = trimmed.replace(/^https?:\/\//i, '');
    if (normalized.includes('@') || normalized.includes('/')) {
      throw new BadRequestException('Invalid host format');
    }
    return normalized;
  }

  private isBlockedIp(ip: string): boolean {
    if (ip.startsWith('127.') || ip === '::1') return true;
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    if (ip.startsWith('169.254.')) return true;
    if (ip.startsWith('172.')) {
      const second = Number(ip.split('.')[1]);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  }

  async validateHost(host: string): Promise<string> {
    const normalizedHost = this.normalizeHost(host);

    const allowPrivate =
      (process.env.ALLOW_PRIVATE_UPSTREAM_HOSTS ?? 'false') === 'true';
    const allowlist = (process.env.VOXIMPLANT_HOST_ALLOWLIST ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const addr = await lookup(normalizedHost).catch(() => null);
    if (!addr) {
      throw new BadRequestException('Unable to resolve upstream host');
    }

    if (
      isIP(normalizedHost) &&
      !allowPrivate &&
      this.isBlockedIp(normalizedHost)
    ) {
      throw new BadRequestException('Upstream host points to restricted IP');
    }

    if (!allowPrivate && this.isBlockedIp(addr.address)) {
      throw new BadRequestException(
        'Resolved upstream host points to restricted IP',
      );
    }

    if (allowlist.length > 0 && !allowlist.includes(normalizedHost)) {
      throw new BadRequestException('Upstream host is not in allowlist');
    }

    return normalizedHost;
  }

  private async postForm<T>(
    url: string,
    payload: Record<string, string>,
  ): Promise<T> {
    const data = new URLSearchParams(payload);
    try {
      const response = await axios.post<T>(url, data.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
      return response.data;
    } catch (err) {
      const error = err as AxiosError;
      if (error.code === 'ECONNABORTED') {
        throw new ServiceUnavailableException('Upstream timeout');
      }
      throw new ServiceUnavailableException('Upstream request failed');
    }
  }

  private async fetchPaged<T>(
    url: string,
    payload: Record<string, string>,
    dedupeKey: (item: T) => string,
  ): Promise<T[]> {
    const first = await this.postForm<VoxResponse<T[]>>(url, {
      ...payload,
      page: '1',
    });
    if (!first?.success || !Array.isArray(first.result)) {
      throw new ServiceUnavailableException('Malformed upstream response');
    }

    const meta = first._meta;
    const pageCount = Math.max(1, Number(meta?.pageCount ?? 1));
    const items = [...first.result];

    for (let page = 2; page <= pageCount && page <= 100; page += 1) {
      const next = await this.postForm<VoxResponse<T[]>>(url, {
        ...payload,
        page: String(page),
      });
      if (!next?.success || !Array.isArray(next.result)) {
        break;
      }
      items.push(...next.result);
    }

    const deduped = new Map<string, T>();
    for (const item of items) {
      deduped.set(dedupeKey(item), item);
    }

    return [...deduped.values()];
  }

  async getAccountInfo(domain: string, host: string, accessToken: string) {
    const safeHost = await this.validateHost(host);
    const url = `https://${safeHost}/api/v3/account/getAccountInfo?domain=${encodeURIComponent(domain)}`;

    const response = await this.postForm<{ success?: boolean; result?: any }>(
      url,
      {
        access_token: accessToken,
      },
    );

    if (!response?.success || !response?.result?.domain) {
      throw new BadRequestException('Voximplant credentials are invalid');
    }

    return response.result.domain;
  }

  async searchUsers(domain: string, host: string, accessToken: string) {
    const safeHost = await this.validateHost(host);
    const url = `https://${safeHost}/api/v3/user/searchUsers?domain=${encodeURIComponent(domain)}`;
    return this.fetchPaged<any>(
      url,
      { access_token: accessToken, 'per-page': '50' },
      (item) => String(item.id),
    );
  }

  async searchGroups(domain: string, host: string, accessToken: string) {
    const safeHost = await this.validateHost(host);
    const url = `https://${safeHost}/api/v3/usergroup/searchGroups?domain=${encodeURIComponent(domain)}`;
    return this.fetchPaged<any>(url, { access_token: accessToken }, (item) =>
      String(item.id),
    );
  }

  async searchQueues(domain: string, host: string, accessToken: string) {
    const safeHost = await this.validateHost(host);
    const url = `https://${safeHost}/api/v3/queues/searchQueues?domain=${encodeURIComponent(domain)}`;
    return this.fetchPaged<any>(
      url,
      { access_token: accessToken, with_users: 'true' },
      (item) => String(item.id),
    );
  }

  async searchTypeStatuses(domain: string, host: string, accessToken: string) {
    const safeHost = await this.validateHost(host);
    const url = `https://${safeHost}/api/v3/agentStatuses/searchStatuses?domain=${encodeURIComponent(domain)}`;
    const response = await this.postForm<VoxResponse<any[]>>(url, {
      access_token: accessToken,
    });
    if (!response?.success || !Array.isArray(response.result)) {
      throw new ServiceUnavailableException('Malformed upstream response');
    }
    return response.result;
  }

  async searchStatuses(
    domain: string,
    host: string,
    accessToken: string,
    query: { from: string; to: string; userIds: number[] },
  ) {
    const safeHost = await this.validateHost(host);
    const url = `https://${safeHost}/api/v3/history/searchStatuses?domain=${encodeURIComponent(domain)}&per-page=50`;
    const result = await this.fetchPaged<any>(
      url,
      {
        access_token: accessToken,
        from: query.from,
        to: query.to,
        user_ids: `[${query.userIds.join(',')}]`,
        'per-page': '50',
      },
      (item) => String(item.id),
    );

    return result.sort((a, b) =>
      String(a.status_start_date).localeCompare(String(b.status_start_date)),
    );
  }
}
