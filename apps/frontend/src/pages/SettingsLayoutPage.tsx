import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../state/auth";

const baseItems = [
  {
    to: "/settings/connection",
    label: "Подключение Voximplant",
    icon: "🔌",
  },
  {
    to: "/settings/profile",
    label: "Профиль и безопасность",
    icon: "👤",
  },
];

const adminItems = [
  {
    to: "/settings/users",
    label: "Пользователи",
    icon: "👥",
  },
  {
    to: "/settings/audit-logs",
    label: "Журнал действий",
    icon: "📋",
  },
];

export function SettingsLayoutPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const hasDeniedParam = searchParams.get("denied") === "1";

  const clearDeniedState = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("denied");
    setSearchParams(next, { replace: true });
  };

  return (
    <section className="settings-shell">
      <aside className="settings-sidebar card" aria-label="Настройки разделов">
        <div className="settings-sidebar-head">
          <div className="section-kicker">Настройки</div>
          <h1>Параметры системы</h1>
          <p>Управление интеграцией, профилем и административными разделами.</p>
        </div>

        <div className="settings-sidebar-group">
          <h2>Интеграция и профиль</h2>
          <nav className="settings-sidebar-nav">
            {baseItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `settings-sidebar-link ${isActive ? "active" : ""}`
                }
              >
                <span className="settings-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {user?.role === "ADMIN" && (
          <div className="settings-sidebar-group">
            <h2>Администрирование</h2>
            <nav className="settings-sidebar-nav">
              {adminItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `settings-sidebar-link ${isActive ? "active" : ""}`
                  }
                >
                  <span className="settings-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </aside>

      <div className="settings-content">
        {hasDeniedParam && (
          <div className="warning-banner">
            <span>
              Недостаточно прав для доступа к разделу администрирования.
            </span>
            <button
              type="button"
              className="button button-secondary"
              onClick={clearDeniedState}
            >
              Скрыть
            </button>
          </div>
        )}
        <Outlet />
      </div>
    </section>
  );
}
