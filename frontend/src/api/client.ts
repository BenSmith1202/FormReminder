const API_BASE = import.meta.env.VITE_API_URL

if (!API_BASE) {
  throw new Error('VITE_API_URL is not set. Check your .env files.')
}

// Core fetch wrapper — always sends cookies, always sets Content-Type
async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,  // allow callers to override/add headers (e.g. X-Org-ID)
    },
  })
  return response
}

export const api = {
  get: (path: string, options?: RequestInit) =>
    apiFetch(path, { ...options, method: 'GET' }),

  post: (path: string, body?: unknown, options?: RequestInit) =>
    apiFetch(path, { ...options, method: 'POST', body: JSON.stringify(body) }),

  put: (path: string, body?: unknown, options?: RequestInit) =>
    apiFetch(path, { ...options, method: 'PUT', body: JSON.stringify(body) }),

  delete: (path: string, options?: RequestInit) =>
    apiFetch(path, { ...options, method: 'DELETE' }),
}