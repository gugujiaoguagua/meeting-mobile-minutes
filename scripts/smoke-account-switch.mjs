const baseUrl = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");

let cookie = "";

function updateCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return;
  cookie = setCookie
    .split(/,(?=[^ ;]+=)/)
    .map((part) => part.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  updateCookie(response);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function login(userId) {
  const { response, payload } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId })
  });
  if (!response.ok) throw new Error(`login ${userId} failed: ${response.status} ${JSON.stringify(payload)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function readState() {
  const { response, payload } = await request("/api/state", { method: "GET" });
  if (!response.ok) throw new Error(`GET /api/state failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function readOkrProjects() {
  const { response, payload } = await request("/api/okr/projects", { method: "GET" });
  if (!response.ok) throw new Error(`GET /api/okr/projects failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload.projects || [];
}

await login("emp-zc25003");
let state = await readState();
let okrProjects = await readOkrProjects();
assert(state.stateScope === "full", "president full state before switch");
assert((state.tasks || []).length >= 1, "president sees task data before switch");
assert(okrProjects.length >= 1, "president sees OKR data before switch");

await login("emp-cp25003");
state = await readState();
okrProjects = await readOkrProjects();
assert(state.stateScope === "visible", "limited user visible state");
assert(Array.isArray(state.tasks), "limited user receives task array");
assert(Array.isArray(okrProjects), "limited user receives OKR array");

await login("emp-zc25003");
state = await readState();
okrProjects = await readOkrProjects();
assert(state.stateScope === "full", "president full state after switch");
assert((state.tasks || []).length >= 1, "president still sees task data after switch");
assert(okrProjects.length >= 1, "president still sees OKR data after switch");
