/** Panel API çağrıları: hata gövdesindeki Türkçe mesajı Error olarak fırlatır; oturum düşmüşse girişe yollar. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Oturum süresi doldu.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `İstek başarısız (${res.status}).`);
  return data as T;
}
