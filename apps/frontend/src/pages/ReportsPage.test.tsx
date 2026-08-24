import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsPage } from "./ReportsPage";
import { useReportStore } from "../state/report";

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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

function getTimelineCalls() {
  return apiRequestMock.mock.calls.filter(([path]) => path === "/timelines/query");
}

beforeEach(() => {
  globalThis.window.localStorage.clear();
  apiRequestMock.mockReset();

  useReportStore.setState({
    selectedDate: "2026-07-21",
    workdayInterval: { from: "09:00", to: "18:00" },
    selectedGroupIds: [],
    selectedQueueIds: [],
    selectedOperatorIds: [101],
    searchText: "",
    isFiltersCollapsed: false,
    isOperatorsCollapsed: false,
    timelineData: null,
    isTimelineBuilt: false,
  });

  apiRequestMock.mockImplementation(
    async (path: string, options?: { body?: string; method?: string }) => {
      if (path === "/catalog/operators") {
        return [
          {
            id: "op-1",
            operatorId: 101,
            fullName: "Анна Иванова",
            timezone: "Europe/Moscow",
            payload: {
              group_id: 1,
              call_status: "READY",
              call_status_change_time: "2026-07-21T08:10:00.000Z",
            },
          },
        ];
      }

      if (path === "/catalog/groups") {
        return [{ id: "g-1", groupId: 1, groupTitle: "Первая группа" }];
      }

      if (path === "/catalog/queues") {
        return [
          {
            id: "q-1",
            queueId: 11,
            queueTitle: "Линия A",
            payload: { users: [{ id: 101 }] },
          },
        ];
      }

      if (path === "/catalog/status-types") {
        return [{ statusKey: "READY", title: "Готов", color: "#32C878" }];
      }

      if (path === "/timelines/query") {
        const payload = JSON.parse(options?.body ?? "{}") as {
          from: string;
          to: string;
          operatorIds: number[];
          timezone: string;
        };

        return {
          from: payload.from,
          to: payload.to,
          timezone: payload.timezone,
          operators: payload.operatorIds.map((operatorId) => ({
            operatorId,
            ok: true,
            presentation: [],
          })),
        };
      }

      throw new Error(`Unexpected path: ${path}; method: ${options?.method ?? "GET"}`);
    },
  );
});

describe("ReportsPage date input", () => {
  it("renders date as dd/mm/yyyy", async () => {
    renderPage();

    await screen.findByText("Анна Иванова");
    const dateInput = screen.getByLabelText("Дата") as HTMLInputElement;

    expect(dateInput.value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("converts valid dd/mm/yyyy to iso date for timeline request", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Анна Иванова");

    const dateInput = screen.getByLabelText("Дата");
    await user.clear(dateInput);
    await user.type(dateInput, "02/03/2026");
    fireEvent.blur(dateInput);

    await user.click(screen.getByRole("button", { name: "Визуализировать" }));

    await waitFor(() => {
      expect(getTimelineCalls()).toHaveLength(1);
    });

    const timelineCall = getTimelineCalls()[0];
    const payload = JSON.parse((timelineCall[1] as { body: string }).body) as {
      from: string;
      to: string;
    };

    expect(payload.from.startsWith("2026-03-02")).toBe(true);
    expect(payload.to.startsWith("2026-03-02")).toBe(true);
  });

  it("shows validation error for invalid date and blocks timeline request", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Анна Иванова");

    const dateInput = screen.getByLabelText("Дата");
    await user.clear(dateInput);
    await user.type(dateInput, "31/02/2026");
    fireEvent.blur(dateInput);

    expect(
      screen.getByText("Укажите корректный день для выбранного месяца."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Визуализировать" }));

    expect(getTimelineCalls()).toHaveLength(0);
  });
});
