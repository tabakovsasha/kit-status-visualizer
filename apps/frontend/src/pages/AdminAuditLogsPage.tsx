import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi, getApiErrorMessage } from "../lib/api";
import { useAuthStore } from "../state/auth";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function normalizeAction(value: string) {
  const map: Record<string, string> = {
    USER_CREATE: "Создание пользователя",
    USER_UPDATE_LOGIN: "Изменение логина",
    USER_RESET_PASSWORD: "Сброс пароля",
    USER_UPDATE: "Изменение пользователя",
    USER_LIST_VIEW: "Просмотр списка пользователей",
    AUDIT_LOG_VIEW: "Просмотр журнала",
  };

  return map[value] ?? value;
}

export function AdminAuditLogsPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expandedDetailsIds, setExpandedDetailsIds] = useState<Set<string>>(
    () => new Set(),
  );

  const logsQuery = useQuery({
    queryKey: ["admin-audit-logs", from, to],
    queryFn: () =>
      adminApi.listAuditLogs(accessToken ?? "", {
        page: 1,
        limit: 100,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      }),
    enabled: !!accessToken,
    staleTime: 15_000,
  });

  const rows = useMemo(
    () => logsQuery.data?.items ?? [],
    [logsQuery.data?.items],
  );

  const stringifyDetails = (value: unknown) => {
    if (value === null || value === undefined) {
      return "—";
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const getCollapsedPreview = (text: string) => {
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact.length <= 96) {
      return compact;
    }

    return `${compact.slice(0, 96)}…`;
  };

  const toggleDetails = (rowId: string) => {
    setExpandedDetailsIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  return (
    <section className="page-grid">
      <div className="page-header compact">
        <div>
          <div className="section-kicker">Администрирование</div>
          <h1>Журнал действий</h1>
          <p>Протокол действий администраторов системы.</p>
        </div>
      </div>

      <section className="card panel">
        <div className="admin-toolbar admin-toolbar-grid">
          <label className="field">
            <span>Дата с</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Дата по</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="admin-audit-table">
            <thead>
              <tr>
                <th>Дата и время</th>
                <th>Администратор</th>
                <th>Действие</th>
                <th>Целевой логин</th>
                <th>IP-адрес</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {(() => {
                    const hasDetails = row.details !== null && row.details !== undefined;
                    const detailsText = hasDetails
                      ? stringifyDetails(row.details)
                      : "—";

                    return (
                      <>
                        <td>{formatDateTime(row.createdAt)}</td>
                        <td>{row.adminLogin}</td>
                        <td>{normalizeAction(row.action)}</td>
                        <td>{row.targetUserLogin ?? "—"}</td>
                        <td>{row.ipAddress ?? "—"}</td>
                        <td className="admin-details-cell">
                          <div className="admin-details-cell-head">
                            <span className="admin-details-cell-summary mono">
                              {hasDetails ? getCollapsedPreview(detailsText) : "—"}
                            </span>
                            <button
                              type="button"
                              className="button button-secondary admin-inline-btn admin-details-toggle"
                              onClick={() => toggleDetails(row.id)}
                              disabled={!hasDetails}
                            >
                              {expandedDetailsIds.has(row.id) ? "Свернуть" : "Развернуть"}
                            </button>
                          </div>

                          {expandedDetailsIds.has(row.id) && hasDetails && (
                            <div className="admin-json-window" aria-label="JSON details">
                              <pre className="admin-json-code mono">
                                <code>{detailsText}</code>
                              </pre>
                            </div>
                          )}
                        </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty-cell">
                    Записи журнала отсутствуют
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {logsQuery.error && (
          <div className="error-banner">
            {getApiErrorMessage(logsQuery.error)}
          </div>
        )}
      </section>
    </section>
  );
}
