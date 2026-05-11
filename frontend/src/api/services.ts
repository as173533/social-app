import { api } from "./client";
import type { AuthResponse, CallLog, Conversation, Friend, FriendRequest, Message, User } from "../types";

export const authApi = {
  register: (data: { name: string; email: string; phone: string; password: string }) =>
    api.post<AuthResponse>("/auth/register", data).then((r) => r.data),
  login: (data: { identifier: string; password: string }) =>
    api.post<AuthResponse>("/auth/login", data).then((r) => r.data),
  me: () => api.get<User>("/auth/me").then((r) => r.data),
  logout: (refreshToken: string) => api.post("/auth/logout", { refresh_token: refreshToken })
};

export const userApi = {
  search: (q: string) => api.get<User[]>("/users/search", { params: { q } }).then((r) => r.data),
  updateMe: (data: Partial<Pick<User, "name" | "avatar" | "bio">>) => api.patch<User>("/users/me", data).then((r) => r.data),
  uploadAvatar: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return api.post<User>("/users/me/avatar", data, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  }
};

export const friendApi = {
  list: () => api.get<Friend[]>("/friends").then((r) => r.data),
  requests: () => api.get<FriendRequest[]>("/friends/requests").then((r) => r.data),
  send: (receiver_id: number) => api.post<FriendRequest>("/friends/requests", { receiver_id }).then((r) => r.data),
  accept: (id: number) => api.post<FriendRequest>(`/friends/requests/${id}/accept`).then((r) => r.data),
  reject: (id: number) => api.post<FriendRequest>(`/friends/requests/${id}/reject`).then((r) => r.data),
  remove: (friendId: number) => api.delete(`/friends/${friendId}`)
};

export const chatApi = {
  conversations: () => api.get<Conversation[]>("/chat/conversations").then((r) => r.data),
  createConversation: (peerId: number) => api.post<Conversation>(`/chat/conversations/${peerId}`).then((r) => r.data),
  messages: (conversationId: number) =>
    api.get<Message[]>(`/chat/conversations/${conversationId}/messages`).then((r) => r.data),
  send: (conversationId: number, body: string) =>
    api.post<Message>(`/chat/conversations/${conversationId}/messages`, { body }).then((r) => r.data),
  read: (conversationId: number, message_ids: number[]) =>
    api.post(`/chat/conversations/${conversationId}/read`, { message_ids })
};

export const callApi = {
  history: () => api.get<CallLog[]>("/calls/history").then((r) => r.data)
};
