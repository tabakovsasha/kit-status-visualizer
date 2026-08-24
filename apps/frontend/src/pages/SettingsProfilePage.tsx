import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authApi, getApiErrorMessage } from "../lib/api";
import { useAuthStore } from "../state/auth";

export function SettingsProfilePage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) {
        throw new Error("Требуется авторизация");
      }

      return authApi.changePassword(accessToken, {
        currentPassword,
        newPassword,
        confirmPassword,
      });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFormError(null);
      setSuccessMessage(
        "Пароль успешно изменен. Для других устройств потребуется повторный вход.",
      );
    },
    onError: (error) => {
      setSuccessMessage(null);
      setFormError(getApiErrorMessage(error));
    },
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (newPassword.length < 8) {
      setFormError("Новый пароль должен содержать минимум 8 символов.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError("Подтверждение пароля не совпадает.");
      return;
    }

    await changePasswordMutation.mutateAsync();
  };

  return (
    <section className="page-grid">
      <div className="page-header compact">
        <div>
          <div className="section-kicker">Профиль</div>
          <h1>Профиль и безопасность</h1>
          <p>
            Управляйте безопасностью учетной записи и контролируйте статус
            сессии.
          </p>
        </div>
      </div>

      <div className="settings-cards-grid">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h2>Информация о пользователе</h2>
              <p>Текущая авторизованная учетная запись.</p>
            </div>
          </div>

          <dl className="account-details">
            <div>
              <dt>Логин</dt>
              <dd>{user?.login ?? "—"}</dd>
            </div>
            <div>
              <dt>Роль</dt>
              <dd>{user?.role ?? "—"}</dd>
            </div>
            <div>
              <dt>Статус сессии</dt>
              <dd>{accessToken ? "Активна" : "Неактивна"}</dd>
            </div>
          </dl>
        </section>

        <section className="card panel">
          <div className="panel-head">
            <div>
              <h2>Смена пароля</h2>
              <p>
                После смены пароля активные сессии на других устройствах будут
                отозваны.
              </p>
            </div>
          </div>

          <form className="form-grid" onSubmit={onSubmit}>
            <label className="field">
              <span>Текущий пароль</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Введите текущий пароль"
              />
            </label>

            <label className="field">
              <span>Новый пароль</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Минимум 8 символов"
              />
            </label>

            <label className="field">
              <span>Подтверждение пароля</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Повторите новый пароль"
              />
            </label>

            {formError && <div className="error-banner">{formError}</div>}
            {successMessage && (
              <div className="success-banner">{successMessage}</div>
            )}

            <div className="form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending
                  ? "Сохранение..."
                  : "Обновить пароль"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}
