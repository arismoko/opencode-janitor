export async function api(path, options) {
  const headers = { 'content-type': 'application/json' };
  const method = options?.method || 'GET';

  if (
    window.__JANITOR_AUTH_TOKEN__ &&
    (method === 'POST' || method === 'DELETE')
  ) {
    headers.authorization = `Bearer ${window.__JANITOR_AUTH_TOKEN__}`;
  }

  const response = await fetch(path, {
    headers,
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Request failed');
  }

  return data;
}
