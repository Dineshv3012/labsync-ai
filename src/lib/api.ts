export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: { path: string; message: string }[]) {
    super(message);
  }
}

const UNAUTH_EVENT = 'labsync:unauthorized';

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'LabSync', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || 'ERROR', data?.message || `Request failed (${res.status}).`, data?.fields);
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
      window.dispatchEvent(new CustomEvent(UNAUTH_EVENT, { detail: err.code }));
    }
    throw err;
  }
  return (data ?? (await res.text())) as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => request<T>('POST', p, form, true),
};
export const onUnauthorized = (fn: (code: string) => void) => {
  const h = (e: Event) => fn((e as CustomEvent).detail);
  window.addEventListener(UNAUTH_EVENT, h);
  return () => window.removeEventListener(UNAUTH_EVENT, h);
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

/** Upload with progress + cancel support (fetch cannot report upload progress). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (pct: number) => void): { promise: Promise<T>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'LabSync');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data.error || 'ERROR', data.message || 'Upload failed.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Upload failed - check your connection and retry.'));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'Upload cancelled.'));
    xhr.send(form);
  });
  return { promise, cancel: () => xhr.abort() };
}
