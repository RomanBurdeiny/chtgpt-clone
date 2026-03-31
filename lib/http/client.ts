export type FetchOpts = RequestInit & { accessToken?: string | null };

export function apiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

export async function apiFetch(path: string, init: FetchOpts = {}): Promise<Response> {
  const { accessToken, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(apiUrl(path), {
    ...rest,
    headers,
    credentials: "include",
  });
}
