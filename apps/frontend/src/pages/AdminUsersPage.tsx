import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminUser, adminApi, getApiErrorMessage } from "../lib/api";
import { useAuthStore } from "../state/auth";

type EditorMode = "create" | "edit";

type EditorState = {
  mode: EditorMode;
  user?: AdminUser;
};

type FormState = {
  login: string;
  password: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Никогда";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AdminUsersPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<FormState>({
    login: "",
    password: "",
    role: "USER",
    isActive: true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminApi.listUsers(accessToken ?? ""),
    enabled: !!accessToken,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) {
        throw new Error("Требуется авторизация");
      }

      if (editor?.mode === "create") {
        return adminApi.createUser(accessToken, {
          login: form.login.trim(),
          password: form.password,
          role: form.role,
        });
      }

      if (!editor?.user) {
        throw new Error("Пользователь для редактирования не найден");
      }

      return adminApi.patchUser(accessToken, editor.user.id, {
        login: form.login.trim(),
        role: form.role,
        isActive: form.isActive,
        ...(form.password.length >= 8 ? { password: form.password } : {}),
      });
    },
    onSuccess: async () => {
      setEditor(null);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error) => {
      setFormError(getApiErrorMessage(error));
    },
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return usersQuery.data ?? [];
    }

    return (usersQuery.data ?? []).filter((item) =>
      item.login.toLowerCase().includes(query),
    );
  }, [usersQuery.data, search]);

  const openCreate = () => {
    setEditor({ mode: "create" });
    setForm({
      login: "",
      password: "",
      role: "USER",
      isActive: true,
    });
    setShowPassword(false);
    setFormError(null);
  };

  const openEdit = (user: AdminUser) => {
    setEditor({ mode: "edit", user });
    setForm({
      login: user.login,
      password: "",
      role: user.role,
      isActive: user.isActive,
    });
    setShowPassword(false);
    setFormError(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (form.login.trim().length < 3) {
      setFormError("Логин должен содержать минимум 3 символа.");
      return;
    }

    if (editor?.mode === "create" && form.password.length < 8) {
      setFormError("Пароль должен содержать минимум 8 символов.");
      return;
    }

    if (
      editor?.mode === "edit" &&
      form.password.length > 0 &&
      form.password.length < 8
    ) {
      setFormError("Новый пароль должен содержать минимум 8 символов.");
      return;
    }

    await saveMutation.mutateAsync();
  };

  return (
    <section className="page-grid">
      <div className="page-header compact">
        <div className="admin-header-row">
          <div>
            <div className="section-kicker">Администрирование</div>
            <h1>Пользователи</h1>
            <p>Создание и управление учетными записями системы.</p>
          </div>
          <button className="button button-primary" onClick={openCreate}>
            + Создать пользователя
          </button>
        </div>
      </div>

      <section className="card panel">
        <div className="admin-toolbar">
          <label className="field">
            <span>Поиск по логину</span>
            <input
              placeholder="Введите логин"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="admin-users-table">
            <thead>
              <tr>
                <th>Логин</th>
                <th>Роль</th>
                <th>Последний вход</th>
                <th>Дата создания</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {(filtered ?? []).map((user) => (
                <tr key={user.id}>
                  <td>{user.login}</td>
                  <td>
                    <span
                      className={`role-badge ${user.role === "ADMIN" ? "admin" : "user"}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td>{formatDateTime(user.lastLoginAt)}</td>
                  <td>{formatDateTime(user.createdAt)}</td>
                  <td>
                    <button
                      className="button button-secondary admin-inline-btn"
                      onClick={() => openEdit(user)}
                    >
                      Редактировать
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="admin-empty-cell">
                    Пользователи не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {usersQuery.error && (
          <div className="error-banner">
            {getApiErrorMessage(usersQuery.error)}
          </div>
        )}
      </section>

      {editor && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2>
              {editor.mode === "create"
                ? "Создание пользователя"
                : "Редактирование пользователя"}
            </h2>
            <p>
              {editor.mode === "create"
                ? "Укажите логин, пароль и роль для новой учетной записи."
                : "Измените логин, роль или задайте новый пароль."}
            </p>

            <form className="form-grid" onSubmit={onSubmit}>
              <label className="field">
                <span>Логин</span>
                <input
                  value={form.login}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, login: event.target.value }))
                  }
                  placeholder="login"
                />
              </label>

              <label className="field">
                <span>
                  Пароль
                  {editor.mode === "edit"
                    ? " (оставьте пустым, чтобы не менять)"
                    : ""}
                </span>
                <div className="password-field-row">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    placeholder="Минимум 8 символов"
                  />
                  <button
                    type="button"
                    className="button button-secondary password-toggle-btn"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "Скрыть" : "Показать"}
                  </button>
                </div>
              </label>

              <label className="field">
                <span>Роль</span>
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      role: event.target.value as "ADMIN" | "USER",
                    }))
                  }
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </label>

              {editor.mode === "edit" && (
                <label className="field checkbox-field">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  <span>Аккаунт активен</span>
                </label>
              )}

              {formError && <div className="error-banner">{formError}</div>}

              <div className="form-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setEditor(null)}
                  disabled={saveMutation.isPending}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
