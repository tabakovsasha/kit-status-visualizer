import { BadRequestException } from '@nestjs/common';
import { TimelineService } from './timeline.service';

describe('timeline service', () => {
  const prisma = {
    voximplantCredential: {
      findFirst: jest.fn(),
    },
  };

  const credentialsService = {
    decryptAccessToken: jest.fn(),
  };

  const api = {
    searchStatuses: jest.fn(),
  };

  let service: TimelineService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TimelineService(
      prisma as any,
      credentialsService as any,
      api as any,
    );

    prisma.voximplantCredential.findFirst.mockResolvedValue({
      domain: 'acme',
      host: 'kit.example.com',
    });
    credentialsService.decryptAccessToken.mockResolvedValue('token_1');
  });

  it('restores first segment from lookback predecessor when continuity is defensible', async () => {
    const fromIso = '2026-07-14T00:00:00.000Z';
    const toIso = '2026-07-14T01:00:00.000Z';

    api.searchStatuses
      .mockResolvedValueOnce([
        {
          id: 100,
          user_id: 10,
          status: 'READY',
          status_start_date: '2026-07-14 00:10:00',
          status_end_date: '2026-07-14 00:20:00',
          next_status: 'ONLINE',
          duration: 600,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 99,
          user_id: 10,
          status: 'ONLINE',
          status_start_date: '2026-07-13 23:40:00',
          status_end_date: '2026-07-14 00:00:00',
          next_status: 'READY',
          duration: 1200,
        },
      ]);

    const result = await service.query('user_1', {
      from: fromIso,
      to: toIso,
      operatorIds: [10],
      timezone: 'UTC',
    });

    const operator = result.operators[0];
    expect(operator.ok).toBe(true);
    expect(operator.timeline[0].status).toBe('ONLINE');
    expect(operator.timeline[0].reason).toBe('Restored from lookback');
    expect(operator.timeline[0].start).toBe(fromIso);
    expect(operator.timeline[0].end).toBe('2026-07-14T00:10:00.000Z');
    expect(operator.aggregates.windowDurationSec).toBe(3600);
    expect(operator.aggregates.measurableDurationSec).toBe(1200);
    expect(operator.aggregates.noDataDurationSec).toBe(2400);
    expect(operator.aggregates.byStatus).toEqual([
      {
        status: 'ONLINE',
        durationSec: 600,
        percentage: 50,
      },
      {
        status: 'READY',
        durationSec: 600,
        percentage: 50,
      },
    ]);
    expect(api.searchStatuses).toHaveBeenCalledTimes(2);
  });

  it('keeps NO_DATA when lookback has no reliable predecessor', async () => {
    api.searchStatuses
      .mockResolvedValueOnce([
        {
          id: 100,
          user_id: 10,
          status: 'READY',
          status_start_date: '2026-07-14 00:10:00',
          status_end_date: '2026-07-14 00:20:00',
          next_status: 'ONLINE',
          duration: 600,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.query('user_1', {
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-14T01:00:00.000Z',
      operatorIds: [10],
      timezone: 'UTC',
    });

    const operator = result.operators[0];
    expect(operator.timeline[0].status).toBe('NO_DATA');
    expect(api.searchStatuses).toHaveBeenCalledTimes(5);
  });

  it('throws when credentials are missing', async () => {
    prisma.voximplantCredential.findFirst.mockResolvedValue(null);

    await expect(
      service.query('user_1', {
        from: '2026-07-14T00:00:00.000Z',
        to: '2026-07-14T01:00:00.000Z',
        operatorIds: [10],
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
