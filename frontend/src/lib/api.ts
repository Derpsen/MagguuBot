export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });

  if (res.status === 401 || res.status === 403) {
    throw new ApiError(res.status, 'unauthorized');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `api error ${res.status}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (null as T);
}
