import { create } from "zustand";
import type { User } from "../types";

type AuthState = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
};

const stored = {
  user: localStorage.getItem("user"),
  accessToken: localStorage.getItem("accessToken"),
  refreshToken: localStorage.getItem("refreshToken")
};

export const useAuthStore = create<AuthState>((set) => ({
  user: stored.user ? JSON.parse(stored.user) : null,
  accessToken: stored.accessToken,
  refreshToken: stored.refreshToken,
  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    set({ user, accessToken, refreshToken });
  },
  clearAuth: () => {
    localStorage.removeItem("user");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    set({ user: null, accessToken: null, refreshToken: null });
  }
}));
