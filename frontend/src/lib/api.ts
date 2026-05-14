export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  });

  if (res.status === 401 || res.status === 403) {
    throw new ApiError(res.status, await readErrorMessage(res, 'unauthorized'));
  }
  if (!res.ok) {
    throw new ApiError(res.status, await readErrorMessage(res, `api error ${res.status}`));
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (null as T);
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return fallback;
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string') return body.error;
    if (typeof body.message === 'string') return body.message;
  } catch {
    /* fall through */
  }
  return text.slice(0, 300);
}
