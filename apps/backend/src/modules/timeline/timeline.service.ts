import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { VoximplantService } from '../voximplant/voximplant.service';
import { VoximplantApiService } from '../voximplant/voximplant-api.service';
import {
  aggregateTimeline,
  buildTimeline,
  presentTimelineForTimezone,
  TimelineSegment,
  RawStatusEvent,
} from './timeline-builder';

@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsService: VoximplantService,
    private readonly api: VoximplantApiService,
  ) {}

  async query(
    ownerUserId: string,
    payload: {
      from: string;
      to: string;
      operatorIds: number[];
      timezone: string;
    },
  ) {
    const credential = await this.prisma.voximplantCredential.findFirst({
      where: { ownerUserId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    if (!credential) {
      throw new BadRequestException('Credentials are not configured');
    }

    const token = await this.credentialsService.decryptAccessToken(ownerUserId);
    if (!token) {
      throw new BadRequestException('Token is not configured');
    }

    const from = payload.from.replace('T', ' ').slice(0, 19);
    const to = payload.to.replace('T', ' ').slice(0, 19);

    const operatorResults = [] as any[];

    for (const operatorId of payload.operatorIds) {
      try {
        const statuses = await this.api.searchStatuses(
          credential.domain,
          credential.host,
          token,
          {
            from,
            to,
            userIds: [operatorId],
          },
        );

        let timeline = buildTimeline(statuses, payload.from, payload.to);
        timeline = await this.restoreFirstSegmentWithLookback(
          credential.domain,
          credential.host,
          token,
          operatorId,
          payload.from,
          timeline,
        );
        const aggregates = aggregateTimeline(
          timeline,
          payload.from,
          payload.to,
        );
        const presentation = presentTimelineForTimezone(
          timeline,
          payload.timezone,
        );

        operatorResults.push({
          operatorId,
          ok: true,
          timeline,
          aggregates,
          presentation,
        });
      } catch {
        operatorResults.push({
          operatorId,
          ok: false,
          error: 'Failed to load statuses for operator',
        });
      }
    }

    return {
      from: payload.from,
      to: payload.to,
      timezone: payload.timezone,
      operators: operatorResults,
    };
  }

  private async restoreFirstSegmentWithLookback(
    domain: string,
    host: string,
    accessToken: string,
    operatorId: number,
    fromIso: string,
    timeline: TimelineSegment[],
  ): Promise<TimelineSegment[]> {
    if (timeline.length === 0) {
      return timeline;
    }

    const first = timeline[0];
    if (first.status !== 'NO_DATA' || !first.isSystem) {
      return timeline;
    }

    const firstReal = timeline.find(
      (segment) => !(segment.isSystem && segment.status === 'NO_DATA'),
    );
    if (!firstReal) {
      return timeline;
    }

    const fromMs = new Date(fromIso).getTime();
    const firstRealStartMs = new Date(firstReal.start).getTime();
    if (firstRealStartMs <= fromMs) {
      return timeline;
    }

    const predecessor = await this.findReliablePredecessor(
      domain,
      host,
      accessToken,
      operatorId,
      fromIso,
      firstReal.status,
    );

    if (!predecessor) {
      return timeline;
    }

    const restored: TimelineSegment = {
      status: predecessor.status,
      start: new Date(fromMs).toISOString(),
      end: new Date(firstRealStartMs).toISOString(),
      durationSec: Math.max(0, Math.floor((firstRealStartMs - fromMs) / 1000)),
      isSystem: false,
      reason: 'Restored from lookback',
    };

    const filtered = timeline.filter((segment, index) => {
      if (index === 0 && segment.status === 'NO_DATA' && segment.isSystem) {
        return false;
      }
      return true;
    });

    return [restored, ...filtered];
  }

  private async findReliablePredecessor(
    domain: string,
    host: string,
    accessToken: string,
    operatorId: number,
    fromIso: string,
    firstInRangeStatus: string,
  ): Promise<RawStatusEvent | null> {
    const fromMs = new Date(fromIso).getTime();
    const lookbackHours = [6, 12, 24, 48];

    for (const hours of lookbackHours) {
      const lookbackFrom = new Date(fromMs - hours * 60 * 60 * 1000);
      const lookbackTo = new Date(fromMs - 1000);
      const rows = await this.api.searchStatuses(domain, host, accessToken, {
        from: this.toApiDate(lookbackFrom),
        to: this.toApiDate(lookbackTo),
        userIds: [operatorId],
      });

      if (!rows.length) {
        continue;
      }

      const candidate = [...rows].sort((a, b) => {
        const endDelta =
          this.parseUpstreamDate(a.status_end_date) -
          this.parseUpstreamDate(b.status_end_date);
        if (endDelta !== 0) {
          return endDelta;
        }
        return (
          this.parseUpstreamDate(a.status_start_date) -
          this.parseUpstreamDate(b.status_start_date)
        );
      })[rows.length - 1];

      const candidateEnd = this.parseUpstreamDate(candidate.status_end_date);
      const candidateOverlapsBoundary = candidateEnd >= fromMs;
      const candidateTouchesBoundary = candidateEnd === fromMs;
      const candidateSuggestsTransition =
        typeof candidate.next_status === 'string' &&
        candidate.next_status === firstInRangeStatus;

      if (
        Number.isFinite(candidateEnd) &&
        (candidateOverlapsBoundary ||
          candidateTouchesBoundary ||
          candidateSuggestsTransition)
      ) {
        return candidate;
      }
    }

    return null;
  }

  private parseUpstreamDate(value: string): number {
    return new Date(value.replace(' ', 'T') + 'Z').getTime();
  }

  private toApiDate(value: Date): string {
    return value.toISOString().replace('T', ' ').slice(0, 19);
  }
}
