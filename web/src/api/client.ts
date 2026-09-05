import { getLocale } from '../i18n';

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const UNAUTHORIZED_EVENT = 'ts3wi:unauthorized';

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', 'X-Locale': getLocale(), ...(init.headers as Record<string, string>) };
  if (url.startsWith('/api/setup')) {
    try {
      const token = sessionStorage.getItem('ts3wi_setup_token');
      if (token) headers['X-Setup-Token'] = token;
    } catch { /* sessionStorage blockiert */ }
  }
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { ...init, method, headers, body: payload, credentials: 'same-origin' });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/me')) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    const message = (data.error as string) || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
