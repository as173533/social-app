import { api } from "./client";
export const authApi = {
    register: (data) => api.post("/auth/register", data).then((r) => r.data),
    login: (data) => api.post("/auth/login", data).then((r) => r.data),
    me: () => api.get("/auth/me").then((r) => r.data),
    forgotPassword: (identifier) => api.post("/auth/password/forgot", { identifier }).then((r) => r.data),
    resetPassword: (data) => api.post("/auth/password/reset", data).then((r) => r.data),
    changePassword: (data) => api.post("/auth/password/change", data).then((r) => r.data),
    logout: (refreshToken) => api.post("/auth/logout", { refresh_token: refreshToken })
};
export const userApi = {
    search: (q) => api.get("/users/search", { params: { q } }).then((r) => r.data),
    updateMe: (data) => api.patch("/users/me", data).then((r) => r.data),
    updateE2EEKey: (e2ee_public_key) => api.put("/users/me/e2ee-key", { e2ee_public_key }).then((r) => r.data),
    uploadAvatar: (file) => {
        const data = new FormData();
        data.append("file", file);
        return api.post("/users/me/avatar", data, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
    }
};
export const friendApi = {
    list: () => api.get("/friends").then((r) => r.data),
    requests: () => api.get("/friends/requests").then((r) => r.data),
    send: (receiver_id) => api.post("/friends/requests", { receiver_id }).then((r) => r.data),
    accept: (id) => api.post(`/friends/requests/${id}/accept`).then((r) => r.data),
    reject: (id) => api.post(`/friends/requests/${id}/reject`).then((r) => r.data),
    remove: (friendId) => api.delete(`/friends/${friendId}`)
};
export const chatApi = {
    conversations: () => api.get("/chat/conversations").then((r) => r.data),
    createConversation: (peerId) => api.post(`/chat/conversations/${peerId}`).then((r) => r.data),
    createGroup: (data) => api.post("/chat/groups", data).then((r) => r.data),
    messages: (conversationId) => api.get(`/chat/conversations/${conversationId}/messages`).then((r) => r.data),
    send: (conversationId, data) => api.post(`/chat/conversations/${conversationId}/messages`, data).then((r) => r.data),
    deleteMessage: (messageId, scope) => api.delete(`/chat/messages/${messageId}`, { data: { scope } }).then((r) => r.data),
    reactToMessage: (messageId, emoji) => api.post(`/chat/messages/${messageId}/reactions`, { emoji }).then((r) => r.data),
    uploadAttachment: (conversationId, file, filename) => {
        const data = new FormData();
        data.append("file", file, filename);
        return api
            .post(`/chat/conversations/${conversationId}/attachments`, data, {
            headers: { "Content-Type": "multipart/form-data" }
        })
            .then((r) => r.data);
    },
    read: (conversationId, message_ids) => api.post(`/chat/conversations/${conversationId}/read`, { message_ids })
};
export const callApi = {
    history: () => api.get("/calls/history").then((r) => r.data)
};
