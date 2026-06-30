import axios, { type AxiosInstance } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10000';

let _accessToken: string | null = null;
let _refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  withCredentials: true,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        if (!_refreshing) {
          _refreshing = refreshAccessToken();
        }
        const newToken = await _refreshing;
        _refreshing = null;
        if (newToken) {
          _accessToken = newToken;
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        }
      } catch {
        _refreshing = null;
        _accessToken = null;
      }
    }
    return Promise.reject(error);
  }
);

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post(`${BASE_URL}/api/auth/refresh`, {}, { withCredentials: true });
    return res.data.accessToken as string;
  } catch {
    return null;
  }
}

export default api;

/* ── Auth ── */
export const authApi = {
  register: (data: { email: string; username: string; display_name: string; password: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  loginWithGoogle: (idToken: string) =>
    api.post('/auth/google', { idToken }),
  refresh: () =>
    api.post('/auth/refresh'),
  logout: () =>
    api.post('/auth/logout'),
  me: () =>
    api.get('/auth/me'),
  updateKeys: (publicKey: string, signingPublicKey: string) =>
    api.put('/auth/keys', { publicKey, signingPublicKey }),
};

/* ── Users ── */
export const usersApi = {
  search: (q: string) =>
    api.get('/users/search', { params: { q } }),
  getById: (id: string) =>
    api.get(`/users/${id}`),
  updateProfile: (data: { display_name?: string; about?: string; username?: string }) =>
    api.put('/users/me/profile', data),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    return api.post('/users/me/avatar', form);
  },
  uploadMedia: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/users/upload', form, {
      onUploadProgress: (e) => {
        if (e.total && onProgress) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    });
  },
  getContacts: () =>
    api.get('/users/me/contacts'),
  addContact: (contactId: string) =>
    api.post(`/users/me/contacts/${contactId}`),
  blockContact: (contactId: string, block: boolean) =>
    api.put(`/users/me/contacts/${contactId}/block`, { block }),
  updatePushSubscription: (subscription: PushSubscription) =>
    api.post('/users/me/push', { subscription }),
};

/* ── Conversations ── */
export const conversationsApi = {
  list: () =>
    api.get('/conversations'),
  getOrCreate: (userId: string) =>
    api.post('/conversations/direct', { userId }),
  createGroup: (data: { name: string; description?: string; memberIds: string[] }) =>
    api.post('/conversations/group', data),
  getById: (id: string) =>
    api.get(`/conversations/${id}`),
  getPending: (id: string) =>
    api.get(`/conversations/${id}/pending`),
  deletePending: (id: string, messageIds: string[]) =>
    api.delete(`/conversations/${id}/pending`, { data: { messageIds } }),
  updateSettings: (id: string, settings: { is_pinned?: boolean; is_archived?: boolean; is_muted?: boolean }) =>
    api.put(`/conversations/${id}/settings`, settings),
  addMembers: (id: string, userIds: string[]) =>
    api.post(`/conversations/${id}/members`, { userIds }),
  leave: (id: string) =>
    api.delete(`/conversations/${id}/leave`),
};

/* ── Calls ── */
export const callsApi = {
  getHistory: () =>
    api.get('/calls'),
  saveCall: (data: object) =>
    api.post('/calls', data),
  updateCall: (id: string, data: object) =>
    api.put(`/calls/${id}`, data),
};

/* ── AI Auto-Reply ── */
export const aiApi = {
  /** Generate an AI reply (plaintext in, plaintext out) */
  generate: (data: {
    conversationId: string;
    incomingMessage: string;
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
    conversationSummary?: string;
  }) => api.post('/ai/generate', data),

  /** Get AI settings for ALL conversations in a single request */
  getAllSettings: () =>
    api.get('/ai/settings'),

  /** Get AI settings for a specific conversation */
  getSettings: (convId: string) =>
    api.get(`/ai/settings/${convId}`),

  /** Enable or disable auto-reply for a conversation */
  setAutoReply: (convId: string, enabled: boolean) =>
    api.put(`/ai/settings/${convId}`, { auto_reply_enabled: enabled }),

  /** Get the user's writing style profile */
  getStyleProfile: () =>
    api.get('/ai/style'),

  /** Submit a batch of the user's own messages to update the style profile */
  updateStyleProfile: (messages: string[]) =>
    api.post('/ai/style', { messages }),
};

/* ── Status ── */
export const statusApi = {
  list: () =>
    api.get('/status'),
  createText: (data: { type: string; content: string; background_color?: string; font_style?: string }) =>
    api.post('/status', data),
  createMedia: (file: File) => {
    const form = new FormData();
    form.append('media', file);
    return api.post('/status/media', form);
  },
  view: (id: string) =>
    api.post(`/status/${id}/view`),
  delete: (id: string) =>
    api.delete(`/status/${id}`),
};
