// Harness comun pentru suita de izolare.
//
// REGULA ABSOLUTĂ: testele de izolare folosesc EXCLUSIV cheia anon + JWT-uri de
// utilizatori reali. `service_role` are BYPASSRLS — dacă ar fi folosit, testele
// ar trece degeaba, ocolind exact ce verifică.
//
// Conexiunea `pg` directă (ca `postgres`) este permisă DOAR pentru:
//   - interogarea catalogului (verificările C*)
//   - semănarea datelor de test
// Niciodată pentru a face aserțiuni de izolare.

import pg from "pg";

export const API = process.env.SUPABASE_API_URL ?? "http://127.0.0.1:54321";
export const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Cheia anon a stack-ului local. Este o valoare implicită publică, identică pe
// orice mașină — CLI-ul însuși o marchează drept "shared default".
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const PASSWORD = "parola-test-123";

export async function db() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

async function signUp(email) {
  await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

export async function login(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.access_token) {
    throw new Error(
      `autentificare eșuată pentru ${email}: ${JSON.stringify(body)}`,
    );
  }
  return body.access_token;
}

/** Cerere PostgREST cu cheia anon + JWT-ul unui utilizator real. */
export async function rest(method, path, token, body) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    Prefer: "return=representation",
  };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** Cerere anonimă: cheia anon, FĂRĂ JWT. */
export async function restAnon(path) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * Doi tenanți, șase utilizatori. Semănat ca `postgres` — legitim: RLS nu se
 * testează la semănare, ci la citire prin PostgREST cu cheia anon.
 *
 * nobody@test.ro rămâne DELIBERAT fără rând în tenant_users.
 */
export async function seed() {
  const users = [
    ["a_citizen@test.ro", "botosani", "citizen"],
    ["a_staff@test.ro", "botosani", "staff"],
    ["a_admin@test.ro", "botosani", "tenant_admin"],
    ["b_citizen@test.ro", "suceava", "citizen"],
    ["b_admin@test.ro", "suceava", "tenant_admin"],
  ];

  for (const [email] of users) await signUp(email);
  await signUp("nobody@test.ro");

  const client = await db();
  try {
    await client.query(`
      insert into public.tenants (slug, hostname, display_name) values
        ('botosani', 'botosani.e-glasul.ro', 'Primaria Botosani'),
        ('suceava',  'suceava.e-glasul.ro',  'Primaria Suceava')
      on conflict (slug) do nothing;
    `);

    for (const [email, slug, role] of users) {
      await client.query(
        `insert into public.tenant_users (user_id, tenant_id, role)
         select u.id, t.id, $3::public.app_role
           from auth.users u, public.tenants t
          where u.email = $1 and t.slug = $2
         on conflict (user_id) do nothing;`,
        [email, slug, role],
      );
    }

    const ids = {};
    const { rows: tenants } = await client.query(
      `select slug, id from public.tenants;`,
    );
    for (const t of tenants) ids[t.slug] = t.id;

    const { rows: authUsers } = await client.query(
      `select email, id from auth.users;`,
    );
    for (const u of authUsers) ids[u.email] = u.id;

    return ids;
  } finally {
    await client.end();
  }
}
