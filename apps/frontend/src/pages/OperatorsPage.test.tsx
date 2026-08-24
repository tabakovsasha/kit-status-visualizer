import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorsPage } from "./OperatorsPage";

const apiRequestMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../state/auth", () => ({
  useAuthStore: (selector: (state: { accessToken: string }) => unknown) =>
    selector({ accessToken: "token_1" }),
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  getApiErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Неизвестная ошибка",
}));

const operators = [
  {
    id: "op-1",
    operatorId: 101,
    fullName: "Анна Иванова",
    timezone: "Europe/Moscow",
    refreshedAt: "2026-07-21T08:00:00.000Z",
    payload: {
      id: 101,
      full_name: "Анна Иванова",
      username: "anna",
      call_status: "READY",
      call_status_change_time: "2026-07-21T08:10:00.000Z",
      profile: { utc: "Europe/Moscow" },
      group_id: 1,
      skills: [{ skill_name: "Продажи" }],
    },
  },
  {
    id: "op-2",
    operatorId: 202,
    fullName: "Петр Смирнов",
    timezone: "Europe/Moscow",
    refreshedAt: "2026-07-21T08:00:00.000Z",
    payload: {
      id: 202,
      full_name: "Петр Смирнов",
      username: "petr",
      call_status: "BUSY",
      call_status_change_time: "2026-07-21T09:20:00.000Z",
      profile: { utc: "Europe/Moscow" },
      group_id: 2,
      skills: [],
    },
  },
  {
    id: "op-3",
    operatorId: 303,
    fullName: "Ольга Петрова",
    timezone: "UTC",
    refreshedAt: "2026-07-21T08:00:00.000Z",
    payload: {
      id: 303,
      full_name: "Ольга Петрова",
      username: "olga",
      call_status: "READY",
      call_status_change_time: "2026-07-21T10:00:00.000Z",
      profile: { utc: "UTC" },
      group_id: 1,
      skills: [],
    },
  },
];

const groups = [
  {
    id: "g1",
    groupId: 1,
    groupTitle: "Первая группа",
    payload: { id: 1, group_title: "Первая группа" },
    refreshedAt: "2026-07-21T08:00:00.000Z",
  },
  {
    id: "g2",
    groupId: 2,
    groupTitle: "Вторая группа",
    payload: { id: 2, group_title: "Вторая группа" },
    refreshedAt: "2026-07-21T08:00:00.000Z",
  },
];

const queues = [
  {
    id: "q1",
    queueId: 11,
    queueTitle: "Линия A",
    refreshedAt: "2026-07-21T08:00:00.000Z",
    payload: {
      id: 11,
      acd_queue_title: "Линия A",
      users: [{ id: 101 }, { id: 202 }],
    },
  },
  {
    id: "q2",
    queueId: 22,
    queueTitle: "Линия B",
    refreshedAt: "2026-07-21T08:00:00.000Z",
    payload: {
      id: 22,
      acd_queue_title: "Линия B",
      users: [{ id: 303 }],
    },
  },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <OperatorsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  navigateMock.mockReset();

  apiRequestMock.mockImplementation(
    async (path: string, options?: { method?: string }) => {
      if (
        path === "/preferences" &&
        (!options?.method || options.method === "GET")
      ) {
        return {};
      }
      if (path === "/preferences" && options?.method === "PUT") {
        return {};
      }
      if (path === "/catalog/queues") return queues;
      if (path === "/catalog/groups") return groups;
      if (path === "/catalog/operators") return operators;
      if (path === "/catalog/status-types") {
        return [
          {
            id: "s-ready",
            statusKey: "READY",
            title: "Готов",
            color: "32C878",
          },
          { id: "s-busy", statusKey: "BUSY", title: "Занят", color: "FFB030" },
        ];
      }
      if (path === "/operator-selections") {
        return [];
      }
      if (path === "/catalog/refresh") {
        return {
          refreshedAt: "2026-07-21T08:00:00.000Z",
          counts: { users: 3, groups: 2, queues: 2, statusTypes: 2 },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  );
});

describe("OperatorsPage", () => {
  it("shows one unified operators table", async () => {
    renderPage();
    expect(
      await screen.findByTestId("operators-unified-table"),
    ).toBeInTheDocument();
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
    expect(screen.getByText("Петр Смирнов")).toBeInTheDocument();
    expect(screen.getByText("Ольга Петрова")).toBeInTheDocument();
  });

  it("applies queue and group filters as intersection", async () => {
    const user = userEvent.setup();
    renderPage();

    const table = await screen.findByTestId("operators-unified-table");

    await user.selectOptions(screen.getByLabelText("Очередь"), "11");
    await user.selectOptions(screen.getByLabelText("Группа"), "1");

    await waitFor(() => {
      expect(within(table).getByText(/Анна/)).toBeInTheDocument();
      expect(within(table).queryByText(/Петр/)).not.toBeInTheDocument();
      expect(within(table).queryByText(/Ольга/)).not.toBeInTheDocument();
      expect(within(table).getAllByRole("checkbox")).toHaveLength(2);
    });
  });

  it("supports header checkbox selection of all visible rows", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("operators-unified-table");
    const headerCheckbox = screen.getByLabelText(
      "Выбрать всех видимых операторов",
    );

    await user.click(headerCheckbox);

    expect(screen.getByText("Выбрано: 3")).toBeInTheDocument();
  });

  it("enables visualize button only when there is selected operator and navigates to timeline", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("operators-unified-table");

    const visualizeButton = screen.getByRole("button", {
      name: "Визуализировать статусы",
    });
    expect(visualizeButton).toBeDisabled();

    await user.click(screen.getByLabelText("Выбрать Анна Иванова"));
    expect(visualizeButton).toBeEnabled();

    await user.click(visualizeButton);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/operator-selections",
        expect.objectContaining({ method: "POST" }),
      );
      expect(navigateMock).toHaveBeenCalledWith("/timeline");
    });
  });
});
