// Thin fetch wrappers that never throw — callers get {ok, status, data}.
export async function getJSON(path) {
  try {
    const r = await fetch(path);
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { detail: "Network error" } };
  }
}

export async function postJSON(path, body, method = "POST") {
  try {
    const r = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { detail: "Network error" } };
  }
}
