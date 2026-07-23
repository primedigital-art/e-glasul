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
    ["a_leadership@test.ro", "botosani", "leadership"],
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

/**
 * Semănarea datelor pentru testele de sesizări. Ca `postgres` (legitim — RLS nu se
 * testează la semănare, ci la citire prin PostgREST cu cheia anon). `postgres` este
 * superuser, deci scrie și în tabelele de istoric (fără politică INSERT) și în coloanele
 * sensibile — exact ce un client NU poate face. Tocmai de aceea semănarea nu dovedește
 * nimic despre izolare; aserțiunile o fac, prin cheia anon.
 *
 * Fiecare sesizare are un `client_submission_id` unic (idempotența nu e testată aici).
 * Un rând de istoric este semănat pe `a_other` pentru a face T58 un test real (există un
 * istoric pe care cetățeanul A NU trebuie să-l vadă), nu doar o listă goală tautologică.
 */
export async function seedIssues(ids) {
  const client = await db();
  const out = {};
  try {
    // Categorii per tenant (seed de onboarding în producție).
    const { rows: cats } = await client.query(`
      insert into public.issue_categories (tenant_id, code, label)
      select t.id, 'groapa', 'Groapă' from public.tenants t
      on conflict (tenant_id, code) do update set label = excluded.label
      returning tenant_id, id;
    `);
    out.cat = {};
    for (const c of cats) {
      if (c.tenant_id === ids.botosani) out.cat.botosani = c.id;
      if (c.tenant_id === ids.suceava) out.cat.suceava = c.id;
    }

    // Sesizări. Coloanele sensibile (author/tenant/status) sunt scrise EXPLICIT la semănare.
    const issues = [
      ["a_own", "botosani", "a_citizen@test.ro"],
      ["a_other", "botosani", "a_staff@test.ro"],
      ["a_flow", "botosani", "a_citizen@test.ro"],
      ["a_stale", "botosani", "a_citizen@test.ro"],
      ["a_forbid", "botosani", "a_citizen@test.ro"],
      ["a_assign", "botosani", "a_citizen@test.ro"],
      ["a_t57", "botosani", "a_citizen@test.ro"],
      ["a_t66", "botosani", "a_citizen@test.ro"],
      ["b_own", "suceava", "b_citizen@test.ro"],
    ];

    out.issue = {};
    for (const [label, slug, authorEmail] of issues) {
      const { rows } = await client.query(
        `
        insert into public.issues
          (tenant_id, author_user_id, category_id, description,
           location_lat, location_lng, client_submission_id)
        values ($1, $2, $3, $4, 47.75, 26.67, gen_random_uuid())
        returning id;
      `,
        [ids[slug], ids[authorEmail], out.cat[slug], `seed ${label}`],
      );
      out.issue[label] = rows[0].id;
    }

    // Un rând de istoric pe `a_other` (issue-ul lui a_staff), pentru T58.
    await client.query(
      `
      insert into public.issue_status_history
        (tenant_id, issue_id, from_status, to_status, actor_user_id, actor_role, acting_as)
      values ($1, $2, 'received', 'in_progress', $3, 'staff', 'official');
    `,
      [ids.botosani, out.issue.a_other, ids["a_staff@test.ro"]],
    );

    return out;
  } finally {
    await client.end();
  }
}

/** RPC PostgREST (funcție) cu cheia anon + JWT. Body = argumentele numite ale funcției. */
export async function rpc(fn, token, args) {
  const headers = {
    apikey: ANON_KEY,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args ?? {}),
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
