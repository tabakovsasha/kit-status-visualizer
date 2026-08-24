import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useAuthStore } from "../state/auth";
import { apiRequest, getApiErrorMessage } from "../lib/api";

type CredentialsState = {
  domain?: string;
  host?: string;
  tokenConfigured: boolean;
  accessTokenMasked?: string;
  lastVerifiedAt?: string;
  accountInfo?: {
    id: number | null;
    name: string | null;
    mediaServerRegions: string[];
    lastCheckedAt?: string | null;
  } | null;
};

type ConnectionFormValues = {
  domain: string;
  host: string;
  access_token: string;
};

function formatVerifiedAt(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function getConnectionErrorLabel(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("unable to resolve upstream host")) {
    return "Хост не удалось разрешить";
  }
  if (normalized.includes("invalid host format")) {
    return "Неверный формат host";
  }
  if (normalized.includes("timeout")) {
    return "Таймаут при проверке";
  }
  if (normalized.includes("malformed upstream response")) {
    return "Некорректный ответ Voximplant API";
  }
  if (normalized.includes("unavailable") || normalized.includes("failed")) {
    return "Voximplant API недоступен";
  }
  if (normalized.includes("invalid") || normalized.includes("unauthorized")) {
    return "Неверный токен или домен";
  }
  return message;
}

export function ConnectionPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const credentialsQuery = useQuery({
    queryKey: ["credentials"],
    queryFn: () =>
      apiRequest<CredentialsState>("/voximplant/credentials", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  const successState = Boolean(credentialsQuery.data?.tokenConfigured);
  const accountInfo = credentialsQuery.data?.accountInfo ?? null;

  const form = useForm<ConnectionFormValues>({
    values: {
      domain: credentialsQuery.data?.domain ?? "",
      host: credentialsQuery.data?.host ?? "",
      access_token: "",
    },
  });
  const { reset } = form;

  useEffect(() => {
    reset({
      domain: credentialsQuery.data?.domain ?? "",
      host: credentialsQuery.data?.host ?? "",
      access_token: "",
    });
  }, [credentialsQuery.data?.domain, credentialsQuery.data?.host, reset]);

  const testMutation = useMutation({
    mutationFn: async (payload: ConnectionFormValues) => {
      return apiRequest<CredentialsState>("/voximplant/credentials/test", {
        method: "PUT",
        body: JSON.stringify(payload),
        accessToken: accessToken ?? undefined,
      });
    },
    onSuccess: async () => {
      setEditMode(false);
      setSubmitError(null);
      await queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (error) => {
      setSubmitError(getConnectionErrorLabel(getApiErrorMessage(error)));
    },
  });

  const locked = successState && !editMode;

  const onSubmit = form.handleSubmit((values) => {
    setSubmitError(null);
    testMutation.mutate(values);
  });

  const regions = useMemo(
    () => accountInfo?.mediaServerRegions ?? [],
    [accountInfo],
  );

  return (
    <section className="page-grid connection-page">
      <div className="page-header compact">
        <div>
          <div className="section-kicker">Подключение</div>
          <h1>Voximplant Kit</h1>
          <p>Настройте доступ к API аккаунта и проверьте авторизацию.</p>
        </div>
      </div>

      <div className="connection-layout">
        <section
          className={`card panel card-connection ${successState ? "state-success" : ""}`}
        >
          <div className="panel-head">
            <div>
              <h2>
                {locked ? "Успешная авторизация" : "Проверка credentials"}
              </h2>
              <p>
                {locked
                  ? "Подключение к Voximplant Kit проверено"
                  : "Введите домен, host и токен, затем сохраните подключение."}
              </p>
            </div>
            {successState && (
              <span className="status-badge status-success">Подключено</span>
            )}
          </div>

          <form className="connection-form" onSubmit={onSubmit}>
            <div className="field-grid field-grid-two">
              <label className="field">
                <span>Имя аккаунта</span>
                <input
                  {...form.register("domain", {
                    required: "Укажите имя аккаунта",
                  })}
                  placeholder="domain"
                  disabled={locked || testMutation.isPending}
                />
              </label>

              <label className="field">
                <span>API host</span>
                <input
                  {...form.register("host", { required: "Укажите API host" })}
                  placeholder="host"
                  disabled={locked || testMutation.isPending}
                />
              </label>
            </div>

            <label className="field">
              <span>Access token</span>
              <input
                type="password"
                {...form.register("access_token")}
                placeholder={
                  successState ? "••••••••••••••••" : "Введите токен Voximplant"
                }
                disabled={locked || testMutation.isPending}
                autoComplete="off"
              />
              <small>
                {successState
                  ? "Пустое поле оставляет сохранённый токен без изменений."
                  : "Token не сохраняется в браузере и используется только для проверки."}
              </small>
            </label>

            {!locked && (
              <div className="form-actions">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending
                    ? "Проверка…"
                    : "Сохранить и проверить"}
                </button>
                {successState && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setEditMode(false);
                      setSubmitError(null);
                      form.reset({
                        domain: credentialsQuery.data?.domain ?? "",
                        host: credentialsQuery.data?.host ?? "",
                        access_token: "",
                      });
                    }}
                  >
                    Отмена
                  </button>
                )}
              </div>
            )}

            {locked && (
              <div className="form-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => setEditMode(true)}
                >
                  Редактировать
                </button>
              </div>
            )}

            {submitError && <div className="error-banner">{submitError}</div>}
            {testMutation.isError && !submitError && (
              <div className="error-banner">Ошибка проверки credentials.</div>
            )}
            {locked && (
              <div className="success-banner">
                <strong>Успешная авторизация</strong>
                <span>
                  Подключение к Voximplant Kit проверено. Последняя проверка:{" "}
                  {formatVerifiedAt(credentialsQuery.data?.lastVerifiedAt)}
                </span>
              </div>
            )}
          </form>
        </section>

        <aside className="card panel account-panel">
          <div className="panel-head">
            <div>
              <h2>Подключённый аккаунт</h2>
              <p>Сохранённые данные доступны только после успешной проверки.</p>
            </div>
          </div>

          {accountInfo ? (
            <dl className="account-details">
              <div>
                <dt>Название</dt>
                <dd>{accountInfo.name ?? "—"}</dd>
              </div>
              <div>
                <dt>ID аккаунта</dt>
                <dd className="mono">{accountInfo.id ?? "—"}</dd>
              </div>
              <div>
                <dt>Медиасерверы</dt>
                <dd>
                  {regions.length > 0 ? (
                    <div className="chip-list">
                      {regions.map((region) => (
                        <span key={region} className="chip">
                          {region}
                        </span>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="empty-state compact">
              <strong>Аккаунт не подтверждён</strong>
              <p>
                Введите credentials и выполните проверку, чтобы увидеть сведения
                об аккаунте.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
