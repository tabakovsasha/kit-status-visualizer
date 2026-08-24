import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../state/auth";
import { authApi, apiRequest } from "../lib/api";

type CredentialsState = {
  tokenConfigured: boolean;
  lastVerifiedAt?: string;
};

const tabs = [
  { to: "/reports", label: "Отчеты" },
  { to: "/settings", label: "Настройки" },
];

export function Layout() {
  const navigate = useNavigate();
  const { accessToken, user, clearAuth } = useAuthStore();

  const credentialsQuery = useQuery({
    queryKey: ["layout-credentials"],
    queryFn: () =>
      apiRequest<CredentialsState>("/voximplant/credentials", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  const onLogout = async () => {
    if (accessToken) {
      await authApi.logout(accessToken).catch(() => undefined);
    }
    clearAuth();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Link to="/reports">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span className="brand-text">
              <strong>Kit Operator Statuses</strong>
              <span>Voximplant timeline analytics</span>
            </span>
          </Link>
        </div>
        <div className="session-info">
          <span
            className={`connection-pill ${credentialsQuery.data?.tokenConfigured ? "is-on" : "is-off"}`}
          >
            {credentialsQuery.data?.tokenConfigured
              ? "Voximplant подключен"
              : "Подключение не настроено"}
          </span>
          <span className="user-pill">{user?.login ?? "—"}</span>
          <button className="button button-secondary" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </header>
      <nav className="main-nav" aria-label="Разделы">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
