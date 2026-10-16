export class HttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function requestJson(url: string, timeoutMs = 8000, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string'
          ? body.detail
          : `HTTP ${response.status}`;
      throw new HttpError(detail);
    }
    if (body === null) {
      throw new HttpError('The response was not JSON.');
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError('The request timed out.');
    }
    throw new HttpError(error instanceof Error ? error.message : 'The request failed.');
  } finally {
    clearTimeout(timer);
  }
}
