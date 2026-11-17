export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function requestJson(url, { method = 'GET', body, signal, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!res.ok) {
    const detail = await res.json().then((data) => data?.error?.message ?? data?.detail, () => null)
    throw new ApiError(typeof detail === 'string' ? detail : `HTTP ${res.status}`, res.status)
  }
  return res.json()
}
