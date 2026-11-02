const JSON_HEADERS = { Accept: "application/json" };

export class HttpError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string) {
    super(`${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
  }
}

export async function fetchJson<T>(input: URL, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, headers: { ...JSON_HEADERS, ...init?.headers }, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new HttpError(response.status, response.statusText);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}
