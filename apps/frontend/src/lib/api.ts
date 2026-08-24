const API_PREFIX = "/api";

export type AuthUser = {
  id: string;
  login: string;
  role: "ADMIN" | "USER";
  mustChangePassword: boolean;
};

export type AdminUser = {
  id: string;
  login: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type AuditLogItem = {
  id: string;
  adminId: string;
  adminLogin: string;
  action: string;
  targetUserLogin?: string | null;
  details?: unknown;
  ipAddress?: string | null;
  createdAt: string;
};

export async function apiRequest<T>(
  path: string,
  options?: RequestInit & { accessToken?: string },
): Promise<T> {
  const headers = new Headers(options?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (options?.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export function getApiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Неизвестная ошибка";
  }

  const raw = error.message?.trim();
  if (!raw) {
    return "Не удалось выполнить запрос";
  }

  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(parsed.message) && parsed.message.length > 0) {
      return parsed.message.join("; ");
    }
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // Keep raw error text when response is not JSON.
  }

  return raw;
}

export const authApi = {
  login: (payload: { login: string; password: string }) =>
    apiRequest<{ accessToken: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  refresh: () =>
    apiRequest<{ accessToken: string; user: AuthUser }>("/auth/refresh", {
      method: "POST",
    }),
  logout: (accessToken: string) =>
    apiRequest<{ success: boolean }>("/auth/logout", {
      method: "POST",
      accessToken,
    }),
  me: (accessToken: string) =>
    apiRequest<AuthUser>("/auth/me", {
      method: "GET",
      accessToken,
    }),
  changeFirstPassword: (
    accessToken: string,
    payload: { newPassword: string; confirmPassword: string },
  ) =>
    apiRequest<{ success: boolean; user: AuthUser }>(
      "/auth/change-first-password",
      {
        method: "POST",
        accessToken,
        body: JSON.stringify(payload),
      },
    ),
  changePassword: (
    accessToken: string,
    payload: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    },
  ) =>
    apiRequest<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      accessToken,
      body: JSON.stringify(payload),
    }),
};

export const adminApi = {
  listUsers: (accessToken: string) =>
    apiRequest<AdminUser[]>("/admin/users", {
      method: "GET",
      accessToken,
    }),
  createUser: (
    accessToken: string,
    payload: { login: string; password: string; role: "ADMIN" | "USER" },
  ) =>
    apiRequest<AdminUser>("/admin/users", {
      method: "POST",
      accessToken,
      body: JSON.stringify(payload),
    }),
  patchUser: (
    accessToken: string,
    userId: string,
    payload: {
      login?: string;
      password?: string;
      role?: "ADMIN" | "USER";
      isActive?: boolean;
    },
  ) =>
    apiRequest<AdminUser>(`/admin/users/${userId}`, {
      method: "PATCH",
      accessToken,
      body: JSON.stringify(payload),
    }),
  listAuditLogs: (
    accessToken: string,
    params?: { page?: number; limit?: number; from?: string; to?: string },
  ) => {
    const query = new URLSearchParams();
    if (params?.page) {
      query.set("page", String(params.page));
    }
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    if (params?.from) {
      query.set("from", params.from);
    }
    if (params?.to) {
      query.set("to", params.to);
    }

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return apiRequest<{
      items: AuditLogItem[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/admin/audit-logs${suffix}`, {
      method: "GET",
      accessToken,
    });
  },
};
