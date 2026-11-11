import type { ApiErrorBody } from '@quid/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function api<T = unknown>(
  path: string,
  opts: { method?: Method; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'GET', body, signal } = opts
  let res: Response
  try {
    res = await fetch(path, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'network', "Can't reach WickyChat. Check your connection and try again.")
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const json = text ? safeParse(text) : null
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? defaultMessage(res.status))
  }
  return json as T
}

function safeParse(t: string) {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

function defaultMessage(status: number) {
  if (status >= 500) return 'Something went wrong on our side. Please try again.'
  if (status === 404) return 'Not found.'
  if (status === 403) return "You don't have permission to do that."
  return 'Request failed.'
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal })
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body })
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body })
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body })

/** Uploads one file with progress reporting. */
export function upload<T>(
  path: string,
  file: File,
  onProgress?: (pct: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', path)
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      const json = safeParse(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as T)
      else
        reject(
          new ApiError(
            xhr.status,
            json?.error?.code ?? 'error',
            json?.error?.message ?? defaultMessage(xhr.status),
          ),
        )
    }
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Upload failed. Check your connection.'))
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload canceled.'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong.'
}
