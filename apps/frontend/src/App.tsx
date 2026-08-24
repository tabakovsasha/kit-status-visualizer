import { Navigate, Route, Routes } from "react-router-dom";
import { FormEvent, ReactElement, useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ConnectionPage } from "./pages/ConnectionPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminAuditLogsPage } from "./pages/AdminAuditLogsPage";
import { SettingsLayoutPage } from "./pages/SettingsLayoutPage";
import { SettingsProfilePage } from "./pages/SettingsProfilePage";
import { useAuthStore } from "./state/auth";
import { authApi, getApiErrorMessage } from "./lib/api";

function RequireAdmin({ children }: { children: ReactElement }) {
  const user = useAuthStore((s) => s.user);

  if (user?.role !== "ADMIN") {
    return <Navigate to="/settings/connection?denied=1" replace />;
  }

  return children;
}

function FirstPasswordChangeModal() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!accessToken || !user?.mustChangePassword) {
    return null;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("Новый пароль должен содержать минимум 8 символов.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Подтверждение пароля не совпадает.");
      return;
    }

    try {
      setPending(true);
      const response = await authApi.changeFirstPassword(accessToken, {
        newPassword,
        confirmPassword,
      });
      setUser(response.user);
      setNewPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal-backdrop blocked" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Требуется смена пароля</h2>
        <p>
          Вы вошли под первичной учетной записью. Для продолжения работы задайте
          новый надежный пароль.
        </p>
        <form className="form-grid" onSubmit={onSubmit}>
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
              placeholder="Повторите пароль"
            />
          </label>

          {error && <div className="error-banner">{error}</div>}

          <div className="form-actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={pending}
            >
              {pending ? "Сохранение..." : "Сменить пароль"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const accessToken = useAuthStore((s) => s.accessToken);

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/operators" element={<Navigate to="/reports" replace />} />
        <Route path="/timeline" element={<Navigate to="/reports" replace />} />
        <Route
          path="/connection"
          element={<Navigate to="/settings/connection" replace />}
        />
        <Route
          path="/admin/users"
          element={<Navigate to="/settings/users" replace />}
        />
        <Route
          path="/admin/audit-logs"
          element={<Navigate to="/settings/audit-logs" replace />}
        />
        <Route path="/settings" element={<SettingsLayoutPage />}>
          <Route
            index
            element={<Navigate to="/settings/connection" replace />}
          />
          <Route path="connection" element={<ConnectionPage />} />
          <Route path="profile" element={<SettingsProfilePage />} />
          <Route
            path="users"
            element={
              <RequireAdmin>
                <AdminUsersPage />
              </RequireAdmin>
            }
          />
          <Route
            path="audit-logs"
            element={
              <RequireAdmin>
                <AdminAuditLogsPage />
              </RequireAdmin>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/reports" replace />} />
    </Routes>
  );
}

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      if (accessToken) {
        if (active) {
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const refreshed = await authApi.refresh();
        if (active) {
          setAuth(refreshed);
        }
      } catch {
        // No refresh session in cookies or refresh failed.
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, [accessToken, setAuth]);

  if (isBootstrapping) {
    return <div className="app-bootstrap">Восстановление сессии...</div>;
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/reports" replace />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
      <FirstPasswordChangeModal />
    </>
  );
}
