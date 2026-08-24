import { create } from "zustand";
import { AuthUser } from "../lib/api";

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (value: { accessToken: string; user: AuthUser }) => void;
  setUser: (user: AuthUser) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (value) => set({ accessToken: value.accessToken, user: value.user }),
  setUser: (user) => set((state) => ({ ...state, user })),
  clearAuth: () => set({ accessToken: null, user: null }),
}));
