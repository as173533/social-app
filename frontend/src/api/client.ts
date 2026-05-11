import axios from "axios";
import { useAuthStore } from "../stores/authStore";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
export const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";

export const api = axios.create({
  baseURL: `${API_URL}/api`
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const refreshToken = useAuthStore.getState().refreshToken;
    if (error.response?.status === 401 && refreshToken && original && !original._retry) {
      original._retry = true;
      try {
        const response = await axios.post(`${API_URL}/api/auth/refresh`, { refresh_token: refreshToken });
        const currentUser = useAuthStore.getState().user;
        if (!currentUser) throw new Error("Missing current user");
        useAuthStore.getState().setAuth(currentUser, response.data.access_token, response.data.refresh_token);
        original.headers.Authorization = `Bearer ${response.data.access_token}`;
        return api(original);
      } catch (refreshError) {
        useAuthStore.getState().clearAuth();
        if (window.location.pathname !== "/login") {
          window.location.assign("/login");
        }
        return Promise.reject(refreshError);
      }
    }
    if (error.response?.status === 401 && !refreshToken) {
      useAuthStore.getState().clearAuth();
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);
