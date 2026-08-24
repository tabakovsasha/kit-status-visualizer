import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineFilterToolbar, TimelinePage } from "./TimelinePage";
import {
  buildUtcWindowIso,
  computeTrackSegments,
  computeWorkingHoursOverlay,
  normalizeStatusColor,
  resolveTimelineTimezone,
  type TimelineSegmentPresentation,
} from "./timeline-utils";

const apiRequestMock = vi.fn();

vi.mock("../state/auth", () => ({
  useAuthStore: (selector: (state: { accessToken: string }) => unknown) =>
    selector({ accessToken: "token_1" }),
}));

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  getApiErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Неизвестная ошибка",
}));

type OperatorItem = {
  id: string;
  operatorId: number;
  fullName: string;
  timezone: string | null;
};

type StatusType = {
  statusKey: string;
  title: string;
  color?: string;
  description?: string;
};

const defaultOperators: OperatorItem[] = [
  {
    id: "op-1",
    operatorId: 101,
    fullName: "Анна Иванова",
    timezone: "Europe/Moscow",
  },
  {
    id: "op-2",
    operatorId: 202,
    fullName: "Петр Смирнов",
    timezone: "Europe/Moscow",
  },
  { id: "op-3", operatorId: 303, fullName: "Ольга Петрова", timezone: "UTC" },
];

const defaultQueues = [
  {
    id: "q-1",
    queueId: 11,
    queueTitle: "Линия A",
    refreshedAt: "2026-07-21T08:00:00.000Z",
    payload: {
      users: [{ id: 101 }, { id: 202 }],
    },
  },
  {
    id: "q-2",
    queueId: 22,
    queueTitle: "Линия B",
    refreshedAt: "2026-07-21T08:00:00.000Z",
    payload: {
      users: [{ id: 303 }],
    },
  },
];

const defaultStatusTypes: StatusType[] = [
  {
    statusKey: "READY",
    title: "Готов",
    color: "32C878",
    description: "Оператор доступен для распределения звонков.",
  },
  {
    statusKey: "BUSY",
    title: "Занят",
    color: "#FFB030",
    description: "Оператор обрабатывает активный контакт.",
  },
  {
    statusKey: "BREAK",
    title: "Перерыв",
    color: "rgba(112, 124, 145, 0.9)",
    description: "Временное отсутствие оператора.",
  },
];

function createPresentation(
  status: string,
  start: string,
  end: string,
): TimelineSegmentPresentation {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const durationSec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return {
    status,
    start,
    end,
    durationSec,
    isSystem: status === "NO_DATA",
    reason: status === "NO_DATA" ? "No data" : undefined,
    startLocal: `2026-07-21 ${start.slice(11, 19)}`,
    endLocal: `2026-07-21 ${end.slice(11, 19)}`,
    startDateKey: "2026-07-21",
    endDateKey: "2026-07-21",
    startOffsetMinutes: 180,
    endOffsetMinutes: 180,
    crossesLocalDateBoundary: false,
  };
}

function makeTimelineResponse(operatorIds: number[], from: string, to: string) {
  const day = from.slice(0, 10);
  const at = (time: string) => `${day}T${time}:00.000Z`;

  return {
    from,
    to,
    timezone: "Europe/Moscow",
    operators: operatorIds.map((operatorId) => ({
      operatorId,
      ok: true,
      aggregates: {
        windowDurationSec: 12 * 60 * 60,
        measurableDurationSec: 12 * 60 * 60,
        noDataDurationSec: 0,
        byStatus: [
          { status: "READY", durationSec: 9 * 60 * 60, percentage: 75 },
          { status: "BUSY", durationSec: 2 * 60 * 60, percentage: 16.6667 },
          { status: "BREAK", durationSec: 1 * 60 * 60, percentage: 8.3333 },
        ],
      },
      presentation:
        operatorId === 202
          ? [
              createPresentation("READY", at("08:00"), at("11:00")),
              createPresentation("MYSTERY", at("11:00"), at("12:00")),
              createPresentation("READY", at("12:00"), at("20:00")),
            ]
          : [
              createPresentation("READY", at("08:00"), at("10:00")),
              createPresentation("BUSY", at("10:00"), at("12:00")),
              createPresentation("BREAK", at("12:00"), at("13:00")),
              createPresentation("READY", at("13:00"), at("20:00")),
            ],
    })),
  };
}

async function renderAndBuild() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <TimelinePage />
    </QueryClientProvider>,
  );

  await screen.findByText("Анна Иванова");
  await user.click(screen.getByRole("button", { name: "Выбрать всех" }));
  await user.click(screen.getByRole("button", { name: "Построить" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("timeline-track").length).toBeGreaterThan(0),
  );
  return user;
}

beforeEach(() => {
  globalThis.window.localStorage.clear();
  globalThis.window.innerWidth = 1440;
  globalThis.window.dispatchEvent(new Event("resize"));
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(
    async (path: string, options?: { body?: string }) => {
      if (path === "/catalog/operators") {
        return defaultOperators;
      }

      if (path === "/catalog/queues") {
        return defaultQueues;
      }

      if (path === "/catalog/status-types") {
        return defaultStatusTypes;
      }

      if (path === "/preferences") {
        return {};
      }

      if (path === "/operator-selections") {
        return [];
      }

      if (path === "/timelines/query") {
        const payload = JSON.parse(options?.body ?? "{}") as {
          operatorIds: number[];
          from: string;
          to: string;
        };
        return makeTimelineResponse(
          payload.operatorIds,
          payload.from,
          payload.to,
        );
      }

      throw new Error(`Unexpected path: ${path}`);
    },
  );
});

describe("timeline utilities", () => {
  it("normalizes HEX colors", () => {
    expect(normalizeStatusColor("AABBCC")).toBe("#AABBCC");
  });

  it("normalizes RGB/RGBA colors", () => {
    expect(normalizeStatusColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(normalizeStatusColor("rgba(1, 2, 3, 0.5)")).toBe(
      "rgba(1, 2, 3, 0.5)",
    );
  });

  it("resolves uniform timezone automatically", () => {
    const resolved = resolveTimelineTimezone(defaultOperators, [101, 202]);
    expect(resolved.warning).toBeNull();
    expect(resolved.backendTimezone).toBe("Europe/Moscow");
  });

  it("resolves mixed timezone with warning and fallback", () => {
    const resolved = resolveTimelineTimezone(
      [
        { operatorId: 1, timezone: "Europe/Moscow" },
        { operatorId: 2, timezone: "UTC+05:00" },
      ],
      [1, 2],
    );
    expect(resolved.warning).toContain("разные часовые пояса");
    expect(resolved.label.length).toBeGreaterThan(0);
  });

  it("clips track segments to common window", () => {
    const segments = computeTrackSegments(
      [
        createPresentation(
          "READY",
          "2026-07-21T07:00:00.000Z",
          "2026-07-21T10:00:00.000Z",
        ),
      ],
      new Date("2026-07-21T08:00:00.000Z").getTime(),
      new Date("2026-07-21T20:00:00.000Z").getTime(),
    );
    expect(segments[0].leftPct).toBe(0);
    expect(segments[0].widthPct).toBeCloseTo((2 / 12) * 100, 3);
  });

  it("builds working-hours overlays before and after work window", () => {
    const overlay = computeWorkingHoursOverlay(
      "2026-07-21",
      "08:00",
      "20:00",
      "09:00",
      "18:00",
    );
    expect(overlay.enabled).toBe(true);
    expect(overlay.beforePct).toBeCloseTo((1 / 12) * 100, 3);
    expect(overlay.afterPct).toBeCloseTo((2 / 12) * 100, 3);
  });

  it("creates one UTC window for all operators", () => {
    const window = buildUtcWindowIso("2026-07-21", "08:00", "20:00");
    expect(window.fromIso).toBe("2026-07-21T08:00:00.000Z");
    expect(window.toIso).toBe("2026-07-21T20:00:00.000Z");
  });
});

describe("TimelinePage component behavior", () => {
  it("renders one track per operator row", async () => {
    await renderAndBuild();
    expect(screen.getAllByTestId("timeline-row")).toHaveLength(3);
    expect(screen.getAllByTestId("timeline-track")).toHaveLength(3);
  });

  it("renders multiple status segments inside the same track", async () => {
    await renderAndBuild();
    const firstTrack = screen.getAllByTestId("timeline-track")[0];
    const segments = firstTrack.querySelectorAll(
      '[data-testid="timeline-segment"]',
    );
    expect(segments.length).toBeGreaterThan(1);
  });

  it("does not render text inside status segments by default", async () => {
    await renderAndBuild();
    const segments = screen.getAllByTestId("timeline-segment");
    segments.forEach((segment) => {
      expect(segment.textContent).toBe("");
    });
  });

  it("does not render date text inside timeline track", async () => {
    await renderAndBuild();
    const track = screen.getAllByTestId("timeline-track")[0];
    expect(track).not.toHaveTextContent("2026-07-21");
  });

  it("keeps one global axis for all operators", async () => {
    await renderAndBuild();
    expect(screen.getAllByTestId("timeline-global-axis")).toHaveLength(1);
  });

  it("uses compact date and time controls", () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TimelinePage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("timeline-date-input")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-display-from")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-display-to")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-work-from")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-work-to")).toBeInTheDocument();
  });

  it("keeps unified 40px height for date/time controls", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("timeline-date-input")).toHaveStyle({
      height: "40px",
    });
    expect(screen.getByTestId("timeline-display-from")).toHaveStyle({
      height: "40px",
    });
    expect(screen.getByTestId("timeline-display-to")).toHaveStyle({
      height: "40px",
    });
    expect(screen.getByTestId("timeline-work-from")).toHaveStyle({
      height: "40px",
    });
    expect(screen.getByTestId("timeline-work-to")).toHaveStyle({
      height: "40px",
    });
  });

  it("uses wider time fields in the header", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("timeline-display-from")).toHaveStyle({
      width: "124px",
    });
    expect(screen.getByTestId("timeline-display-to")).toHaveStyle({
      width: "124px",
    });
    expect(screen.getByTestId("timeline-work-from")).toHaveStyle({
      width: "124px",
    });
    expect(screen.getByTestId("timeline-work-to")).toHaveStyle({
      width: "124px",
    });
  });

  it("shows queue loading state in the toolbar", () => {
    render(
      <TimelineFilterToolbar
        selectedDate="2026-07-21"
        displayFrom="08:00"
        displayTo="20:00"
        workFrom="09:00"
        workTo="18:00"
        selectedQueueId="all"
        queueOptions={[]}
        queuesLoading
        queuesError={false}
        timezone={resolveTimelineTimezone(defaultOperators, [101, 202])}
        isPending={false}
        isDisabled={false}
        onBuild={() => undefined}
        onDateChange={() => undefined}
        onDisplayFromChange={() => undefined}
        onDisplayToChange={() => undefined}
        onWorkFromChange={() => undefined}
        onWorkToChange={() => undefined}
        onQueueChange={() => undefined}
        onRetryQueues={() => undefined}
      />,
    );

    expect(screen.getByTestId("timeline-queue-select")).toBeDisabled();
    expect(screen.getByText("Загрузка очередей…")).toBeInTheDocument();
  });

  it("shows compact queue error state in the toolbar", () => {
    render(
      <TimelineFilterToolbar
        selectedDate="2026-07-21"
        displayFrom="08:00"
        displayTo="20:00"
        workFrom="09:00"
        workTo="18:00"
        selectedQueueId="all"
        queueOptions={[]}
        queuesLoading={false}
        queuesError
        timezone={resolveTimelineTimezone(defaultOperators, [101, 202])}
        isPending={false}
        isDisabled={false}
        onBuild={() => undefined}
        onDateChange={() => undefined}
        onDisplayFromChange={() => undefined}
        onDisplayToChange={() => undefined}
        onWorkFromChange={() => undefined}
        onWorkToChange={() => undefined}
        onQueueChange={() => undefined}
        onRetryQueues={() => undefined}
      />,
    );

    expect(
      screen.getByText("Не удалось загрузить очереди."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
  });

  it("renders queue filter with all queues", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    const select = await screen.findByTestId("timeline-queue-select");
    await screen.findByRole("option", { name: "Все очереди" });
    expect(select).toBeEnabled();
    expect(
      screen.getByRole("option", { name: "Все очереди" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Линия A/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Линия B/ })).toBeInTheDocument();
  });

  it("filters operator list by selected queue", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.selectOptions(screen.getByTestId("timeline-queue-select"), "22");

    await waitFor(() => {
      expect(screen.queryByText("Анна Иванова")).not.toBeInTheDocument();
      expect(screen.queryByText("Петр Смирнов")).not.toBeInTheDocument();
      expect(screen.getByText("Ольга Петрова")).toBeInTheDocument();
    });
  });

  it("inherits queue from saved Operators selection when it is consistent", async () => {
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") return defaultOperators;
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") {
          return {
            operatorsPageState: { selectedQueueId: 11 },
          };
        }
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") {
          return [
            {
              id: "sel-1",
              name: "Timeline selection",
              items: [{ operatorId: 101 }, { operatorId: 202 }],
            },
          ];
        }
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          return makeTimelineResponse(
            payload.operatorIds,
            payload.from,
            payload.to,
          );
        }
        throw new Error("unexpected");
      },
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    expect(screen.getByTestId("timeline-queue-select")).toHaveValue("11");
    expect(screen.queryByText("Ольга Петрова")).not.toBeInTheDocument();
  });

  it("falls back to all queues when saved selection spans different queues", async () => {
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") return defaultOperators;
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") {
          return {
            operatorsPageState: { selectedQueueId: 11 },
          };
        }
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") {
          return [
            {
              id: "sel-1",
              name: "Timeline selection",
              items: [{ operatorId: 101 }, { operatorId: 303 }],
            },
          ];
        }
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          return makeTimelineResponse(
            payload.operatorIds,
            payload.from,
            payload.to,
          );
        }
        throw new Error("unexpected");
      },
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    expect(screen.getByTestId("timeline-queue-select")).toHaveValue("all");
  });

  it("disables build when selected queue has no selected operators", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.selectOptions(screen.getByTestId("timeline-queue-select"), "22");

    const build = screen.getByRole("button", { name: "Построить" });
    expect(build).toBeDisabled();
    expect(
      screen.getByText("Выберите хотя бы одного оператора из этой очереди."),
    ).toBeInTheDocument();
  });

  it("keeps build payload limited to selected operators in current queue", async () => {
    const requests: Array<number[]> = [];
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") return defaultOperators;
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") return {};
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") return [];
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          requests.push(payload.operatorIds);
          return makeTimelineResponse(
            payload.operatorIds,
            payload.from,
            payload.to,
          );
        }
        throw new Error("unexpected");
      },
    );

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.click(screen.getByRole("button", { name: "Выбрать всех" }));
    await user.selectOptions(screen.getByTestId("timeline-queue-select"), "22");
    await user.click(screen.getByRole("button", { name: "Построить" }));

    await waitFor(() => expect(requests[0]).toEqual([303]));
  });

  it("does not render Today button and keeps date picker active", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "Сегодня" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("timeline-date-input")).toBeInTheDocument();
  });

  it("shows a compact empty state when queue has no operators", async () => {
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") return defaultOperators;
        if (path === "/catalog/queues") {
          return [
            ...defaultQueues,
            {
              id: "q-3",
              queueId: 33,
              queueTitle: "Пустая очередь",
              refreshedAt: "2026-07-21T08:00:00.000Z",
              payload: { users: [] },
            },
          ];
        }
        if (path === "/preferences") return {};
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") return [];
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          return makeTimelineResponse(
            payload.operatorIds,
            payload.from,
            payload.to,
          );
        }
        throw new Error("unexpected");
      },
    );

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.selectOptions(screen.getByTestId("timeline-queue-select"), "33");

    expect(
      await screen.findByTestId("timeline-empty-queue"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("В этой очереди нет операторов"),
    ).toBeInTheDocument();
  });

  it("shows queue loading state while catalog is pending", async () => {
    apiRequestMock.mockImplementation(
      (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators")
          return Promise.resolve(defaultOperators);
        if (path === "/catalog/queues") {
          return new Promise<typeof defaultQueues>((resolve) => {
            window.setTimeout(() => resolve(defaultQueues), 0);
          });
        }
        if (path === "/preferences") return Promise.resolve({});
        if (path === "/catalog/status-types")
          return Promise.resolve(defaultStatusTypes);
        if (path === "/operator-selections") return Promise.resolve([]);
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          return Promise.resolve(
            makeTimelineResponse(payload.operatorIds, payload.from, payload.to),
          );
        }
        return Promise.reject(new Error("unexpected"));
      },
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    const queueSelect = screen.getByTestId("timeline-queue-select");
    expect(queueSelect).toBeDisabled();
    expect(screen.getByText("Загрузка очередей…")).toBeInTheDocument();

    await screen.findByRole("option", { name: "Все очереди" });
  });

  it("keeps build button compact and not full width", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    const build = screen.getByRole("button", { name: "Построить" });
    expect(build).toHaveStyle({ width: "auto" });
    expect(build).toHaveStyle({ height: "42px" });
  });

  it("keeps display period fields in one group", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    const group = screen.getByTestId("timeline-filter-group-display-period");
    expect(
      group.querySelector('[data-testid="timeline-display-from"]'),
    ).toBeTruthy();
    expect(
      group.querySelector('[data-testid="timeline-display-to"]'),
    ).toBeTruthy();
  });

  it("keeps working hours fields in one group", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    const group = screen.getByTestId("timeline-filter-group-working-hours");
    expect(
      group.querySelector('[data-testid="timeline-work-from"]'),
    ).toBeTruthy();
    expect(
      group.querySelector('[data-testid="timeline-work-to"]'),
    ).toBeTruthy();
  });

  it("shows timezone as readonly info block", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    expect(
      screen.getByTestId("timeline-timezone-readonly"),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Europe/Berlin"),
    ).not.toBeInTheDocument();
  });

  it("shows mixed-timezone warning in UI when needed", async () => {
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") {
          return [
            {
              id: "op-1",
              operatorId: 101,
              fullName: "Анна Иванова",
              timezone: "Europe/Moscow",
            },
            {
              id: "op-2",
              operatorId: 202,
              fullName: "Петр Смирнов",
              timezone: "UTC+05:00",
            },
          ];
        }
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") return {};
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") return [];
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          return makeTimelineResponse(
            payload.operatorIds,
            payload.from,
            payload.to,
          );
        }
        throw new Error("unexpected");
      },
    );

    await renderAndBuild();
    expect(
      screen.getByLabelText("Есть различие timezone операторов"),
    ).toBeInTheDocument();
  });

  it("keeps equal segment coordinates across different operator rows for same times", async () => {
    await renderAndBuild();
    const rows = screen.getAllByTestId("timeline-row");
    const firstRowSegments = rows[0].querySelectorAll(
      '[data-testid="timeline-segment"]',
    );
    const secondRowSegments = rows[1].querySelectorAll(
      '[data-testid="timeline-segment"]',
    );

    expect((firstRowSegments[0] as HTMLElement).style.left).toBe(
      (secondRowSegments[0] as HTMLElement).style.left,
    );
  });

  it("does not use flex-wrap on track container", async () => {
    await renderAndBuild();
    const track = screen.getAllByTestId("timeline-track")[0];
    expect(track).not.toHaveStyle({ flexWrap: "wrap" });
  });

  it("highlights only hovered segment and does not change width", async () => {
    const user = await renderAndBuild();
    const segments = screen.getAllByTestId("timeline-segment");
    const target = segments[0] as HTMLElement;
    const beforeWidth = target.style.width;

    await user.hover(target);
    expect(target.className).toContain("is-hovered");
    expect(target.style.width).toBe(beforeWidth);

    const sibling = segments[1] as HTMLElement;
    expect(sibling.className).toContain("is-dimmed");
  });

  it("shows tooltip with title, time range, duration, and description", async () => {
    const user = await renderAndBuild();
    const segment = screen.getAllByTestId("timeline-segment")[0];
    await user.hover(segment);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Готов");
    expect(tooltip).toHaveTextContent("11:00:00 — 13:00:00");
    expect(tooltip).toHaveTextContent("2 ч 00 мин");
    expect(tooltip).toHaveTextContent(
      "Оператор доступен для распределения звонков.",
    );
  });

  it("rebuilds query window when active timezone changes", async () => {
    const timelineBodies: Array<{ from: string; to: string }> = [];

    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") {
          return [
            {
              id: "op-1",
              operatorId: 101,
              fullName: "Анна Иванова",
              timezone: "UTC",
            },
            {
              id: "op-2",
              operatorId: 202,
              fullName: "Петр Смирнов",
              timezone: "UTC+05:00",
            },
          ];
        }
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") return {};
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") return [];
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          timelineBodies.push({ from: payload.from, to: payload.to });
          return makeTimelineResponse(
            payload.operatorIds,
            payload.from,
            payload.to,
          );
        }
        throw new Error("unexpected");
      },
    );

    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.click(
      screen
        .getAllByText("Анна Иванова")[0]
        .closest("label") as HTMLLabelElement,
    );
    await user.click(screen.getByRole("button", { name: "Построить" }));
    await waitFor(() => expect(timelineBodies.length).toBe(1));

    await user.click(screen.getByRole("button", { name: "Показать список ∨" }));

    await user.click(
      screen
        .getAllByText("Анна Иванова")[0]
        .closest("label") as HTMLLabelElement,
    );
    await user.click(
      screen
        .getAllByText("Петр Смирнов")[0]
        .closest("label") as HTMLLabelElement,
    );
    await user.click(screen.getByRole("button", { name: "Построить" }));
    await waitFor(() => expect(timelineBodies.length).toBe(2));

    expect(timelineBodies[0].from).not.toBe(timelineBodies[1].from);
  });

  it("uses color from status dictionary", async () => {
    await renderAndBuild();
    const segment = screen
      .getAllByTestId("timeline-segment")
      .find((item) => item.getAttribute("data-status") === "READY");
    expect(segment).toBeTruthy();
    expect(
      (segment as HTMLElement).style.backgroundColor.length,
    ).toBeGreaterThan(0);
  });

  it("uses fallback color for unknown statuses", async () => {
    await renderAndBuild();
    const unknown = screen
      .getAllByTestId("timeline-segment")
      .find((item) => item.getAttribute("data-status") === "MYSTERY");
    expect(unknown).toBeTruthy();
    expect(
      (unknown as HTMLElement).style.backgroundColor.length,
    ).toBeGreaterThan(0);
  });

  it("renders working-hours overlay before and after work window", async () => {
    await renderAndBuild();
    expect(
      screen.getAllByTestId("timeline-working-overlay-before").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("timeline-working-overlay-after").length,
    ).toBeGreaterThan(0);
  });

  it("keeps real segment colors under desaturated overlay", async () => {
    await renderAndBuild();
    const segment = screen.getAllByTestId("timeline-segment")[0] as HTMLElement;
    expect(segment.style.backgroundColor.length).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("timeline-working-overlay-before")[0],
    ).toBeInTheDocument();
  });

  it("shows tooltip even for segment in out-of-working area", async () => {
    const user = await renderAndBuild();
    const firstSegment = screen.getAllByTestId("timeline-segment")[0];
    await user.hover(firstSegment);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });

  it("keeps one row height regardless of status count", async () => {
    await renderAndBuild();
    const rows = screen.getAllByTestId("timeline-row");
    expect(rows[0].className).toContain("timeline2-row");
    expect(rows[1].className).toContain("timeline2-row");
  });

  it("renders loading skeleton with single track geometry", async () => {
    let releaseRequest: undefined | (() => void);
    apiRequestMock.mockImplementation(
      (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators")
          return Promise.resolve(defaultOperators);
        if (path === "/catalog/queues") return Promise.resolve(defaultQueues);
        if (path === "/preferences") return Promise.resolve({});
        if (path === "/catalog/status-types")
          return Promise.resolve(defaultStatusTypes);
        if (path === "/operator-selections") return Promise.resolve([]);
        if (path === "/timelines/query") {
          return new Promise((resolve) => {
            releaseRequest = () => {
              const payload = JSON.parse(options?.body ?? "{}") as {
                operatorIds: number[];
                from: string;
                to: string;
              };
              resolve(
                makeTimelineResponse(
                  payload.operatorIds,
                  payload.from,
                  payload.to,
                ),
              );
            };
          });
        }
        return Promise.reject(new Error("unexpected"));
      },
    );

    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.click(screen.getByRole("button", { name: "Выбрать всех" }));
    await user.click(screen.getByRole("button", { name: "Построить" }));

    expect(
      document.querySelectorAll(".timeline2-skeleton-track").length,
    ).toBeGreaterThan(0);

    if (releaseRequest) {
      releaseRequest();
    }
    await waitFor(() =>
      expect(screen.getAllByTestId("timeline-track").length).toBeGreaterThan(0),
    );
  });

  it("allows retry button for per-operator error state", async () => {
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") return defaultOperators;
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") return {};
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") return [];
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };
          return {
            from: payload.from,
            to: payload.to,
            timezone: "Europe/Moscow",
            operators: payload.operatorIds.map((id) =>
              id === 202
                ? {
                    operatorId: id,
                    ok: false,
                    error: "Failed to load statuses for operator",
                  }
                : makeTimelineResponse([id], payload.from, payload.to)
                    .operators[0],
            ),
          };
        }
        throw new Error("unexpected");
      },
    );

    await renderAndBuild();
    expect(
      screen.getByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
  });

  it("has compact toolbar in single container", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("timeline-filter-toolbar")).toBeInTheDocument();
  });

  it("supports keyboard focus tooltip on segment", async () => {
    await renderAndBuild();
    const segment = screen.getAllByTestId("timeline-segment")[0];
    fireEvent.focus(segment);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });

  it("keeps a single timeline track per operator even with many statuses", async () => {
    await renderAndBuild();
    const rows = screen.getAllByTestId("timeline-row");
    rows.forEach((row) => {
      expect(
        row.querySelectorAll('[data-testid="timeline-track"]').length,
      ).toBe(1);
    });
  });

  it("renders operator panel expanded by default", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    expect(
      screen.getByTestId("timeline-operators-content"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Скрыть список ∧" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses and expands operator panel via disclosure control", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.click(screen.getByRole("button", { name: "Скрыть список ∧" }));
    expect(
      screen.queryByTestId("timeline-operators-content"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Показать список ∨" }),
    ).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Показать список ∨" }));
    expect(
      screen.getByTestId("timeline-operators-content"),
    ).toBeInTheDocument();
  });

  it("persists operator panel state in localStorage", async () => {
    globalThis.window.localStorage.setItem("timeline2-operators-expanded", "0");

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Операторы");
    expect(
      screen.queryByTestId("timeline-operators-content"),
    ).not.toBeInTheDocument();
  });

  it("shows four columns on desktop operator grid", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    const grid = screen.getByTestId("timeline-operator-grid");
    expect(grid).toHaveAttribute("data-columns", "4");
  });

  it("switches to three columns near 1180 width", async () => {
    globalThis.window.innerWidth = 1180;
    globalThis.window.dispatchEvent(new Event("resize"));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    expect(screen.getByTestId("timeline-operator-grid")).toHaveAttribute(
      "data-columns",
      "3",
    );
  });

  it("switches to two columns near 850 width", async () => {
    globalThis.window.innerWidth = 850;
    globalThis.window.dispatchEvent(new Event("resize"));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    expect(screen.getByTestId("timeline-operator-grid")).toHaveAttribute(
      "data-columns",
      "2",
    );
  });

  it("switches to one column on mobile width", async () => {
    globalThis.window.innerWidth = 390;
    globalThis.window.dispatchEvent(new Event("resize"));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    expect(screen.getByTestId("timeline-operator-grid")).toHaveAttribute(
      "data-columns",
      "1",
    );
  });

  it("keeps compact checkbox size and accent color", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    const checkbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(checkbox).toHaveStyle({ width: "18px", height: "18px" });
    expect(checkbox).toHaveStyle({ accentColor: "#8B55FF" });
  });

  it("opens operators panel and shows validation when build clicked with empty selection", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.selectOptions(screen.getByTestId("timeline-queue-select"), "22");

    expect(screen.getByRole("button", { name: "Построить" })).toBeDisabled();
    expect(
      screen.getByText("Выберите хотя бы одного оператора из этой очереди."),
    ).toBeInTheDocument();
  });

  it("shows global no-data empty state when all selected operators have no data", async () => {
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") return defaultOperators;
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") return {};
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") return [];
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };

          return {
            from: payload.from,
            to: payload.to,
            timezone: "Europe/Moscow",
            operators: payload.operatorIds.map((operatorId) => ({
              operatorId,
              ok: true,
              aggregates: {
                windowDurationSec: 12 * 60 * 60,
                measurableDurationSec: 0,
                noDataDurationSec: 12 * 60 * 60,
                byStatus: [],
              },
              presentation: [],
            })),
          };
        }
        throw new Error("unexpected");
      },
    );

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimelinePage />
      </QueryClientProvider>,
    );

    await screen.findByText("Анна Иванова");
    await user.click(screen.getByRole("button", { name: "Выбрать всех" }));
    await user.click(screen.getByRole("button", { name: "Построить" }));

    expect(
      await screen.findByTestId("timeline-empty-today"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Нет данных о статусах за выбранный период"),
    ).not.toBeInTheDocument();
  });

  it("keeps row-level no-data state for partial empty responses", async () => {
    apiRequestMock.mockImplementation(
      async (path: string, options?: { body?: string }) => {
        if (path === "/catalog/operators") return defaultOperators;
        if (path === "/catalog/queues") return defaultQueues;
        if (path === "/preferences") return {};
        if (path === "/catalog/status-types") return defaultStatusTypes;
        if (path === "/operator-selections") return [];
        if (path === "/timelines/query") {
          const payload = JSON.parse(options?.body ?? "{}") as {
            operatorIds: number[];
            from: string;
            to: string;
          };

          const full = makeTimelineResponse(
            payload.operatorIds,
            payload.from,
            payload.to,
          );
          return {
            from: payload.from,
            to: payload.to,
            timezone: "Europe/Moscow",
            operators: full.operators.map((item) =>
              item.operatorId === 202
                ? {
                    operatorId: item.operatorId,
                    ok: true,
                    aggregates: {
                      windowDurationSec: 12 * 60 * 60,
                      measurableDurationSec: 0,
                      noDataDurationSec: 12 * 60 * 60,
                      byStatus: [],
                    },
                    presentation: [],
                  }
                : item,
            ),
          };
        }
        throw new Error("unexpected");
      },
    );

    await renderAndBuild();
    expect(
      screen.queryByTestId("timeline-empty-today"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Нет данных о статусах за выбранный период"),
    ).toBeInTheDocument();
  });
});
