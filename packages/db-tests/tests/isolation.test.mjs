// Suita de izolare cross-tenant și cross-rol (T*) din ADR-0002 și ADR-0003.
//
// TOATE cererile trec prin PostgREST cu CHEIA ANON + JWT de utilizator real.
// `service_role` NU apare nicăieri: are BYPASSRLS, deci ar face testele să treacă
// degeaba, ocolind exact frontiera pe care o verifică.
//
// Notă de citit înainte de a interpreta rezultatele:
// un UPDATE respins de clauza USING întoarce HTTP 200 cu [] (zero rânduri
// afectate), NU 403. Doar violarea lui WITH CHECK ridică 403/42501. Ambele sunt
// blocaje reale — dar aplicația nu are voie să citească 200 ca „a mers".

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, login, rest, restAnon, seed } from "../src/harness.mjs";

let ids;
const tok = {};

before(async () => {
  ids = await seed();
  for (const who of [
    "a_citizen",
    "a_staff",
    "a_admin",
    "b_citizen",
    "b_admin",
    "nobody",
  ]) {
    tok[who] = await login(`${who}@test.ro`);
  }
});

/** Un UPDATE/INSERT blocat: fie 403 (WITH CHECK), fie 200 cu zero rânduri (USING). */
function assertScrieBlocata(res, mesaj) {
  const blocat =
    res.status === 403 ||
    res.status === 401 ||
    (res.status === 200 && Array.isArray(res.body) && res.body.length === 0);
  assert.ok(
    blocat,
    `${mesaj}\n  A REUȘIT: HTTP ${res.status} ${JSON.stringify(res.body)}`,
  );
}

// ---------------------------------------------------------------------------
// Citire
// ---------------------------------------------------------------------------

test("T1 — citizen A își vede DOAR propriul rând", async () => {
  const r = await rest(
    "GET",
    "tenant_users?select=user_id,role",
    tok.a_citizen,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].user_id, ids["a_citizen@test.ro"]);
});

test("T2 — staff A NU este admin: vede tot doar propriul rând", async () => {
  const r = await rest("GET", "tenant_users?select=user_id", tok.a_staff);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].user_id, ids["a_staff@test.ro"]);
});

test("T3 — tenant_admin A vede utilizatorii lui A și NICIUNUL al lui B", async () => {
  const r = await rest("GET", "tenant_users?select=tenant_id", tok.a_admin);
  assert.equal(r.body.length, 3);
  for (const row of r.body) assert.equal(row.tenant_id, ids.botosani);
});

test("T4 — tenant_admin A cere EXPLICIT utilizatorii lui B: zero rânduri", async () => {
  const r = await rest(
    "GET",
    `tenant_users?tenant_id=eq.${ids.suceava}&select=user_id`,
    tok.a_admin,
  );
  assert.deepEqual(r.body, []);
});

test("T5 — citizen A vede DOAR tenantul A", async () => {
  const r = await rest("GET", "tenants?select=slug", tok.a_citizen);
  assert.deepEqual(r.body, [{ slug: "botosani" }]);
});

test("T6 — citizen A cere EXPLICIT tenantul B: zero rânduri", async () => {
  const r = await rest(
    "GET",
    `tenants?id=eq.${ids.suceava}&select=slug`,
    tok.a_citizen,
  );
  assert.deepEqual(r.body, []);
});

// ---------------------------------------------------------------------------
// Escaladare de rol
// ---------------------------------------------------------------------------

test("T7 — citizen A NU își poate acorda singur rolul tenant_admin", async () => {
  const r = await rest(
    "PATCH",
    `tenant_users?user_id=eq.${ids["a_citizen@test.ro"]}`,
    tok.a_citizen,
    { role: "tenant_admin" },
  );
  assertScrieBlocata(
    r,
    "T7: un cetățean și-a acordat singur rol de administrator!",
  );

  const client = await db();
  const { rows } = await client.query(
    `select role from public.tenant_users where user_id = $1;`,
    [ids["a_citizen@test.ro"]],
  );
  await client.end();
  assert.equal(
    rows[0].role,
    "citizen",
    "T7: rolul s-a schimbat efectiv în bază!",
  );
});

test("T8 — tenant_admin A NU își poate schimba propriul rol", async () => {
  const r = await rest(
    "PATCH",
    `tenant_users?user_id=eq.${ids["a_admin@test.ro"]}`,
    tok.a_admin,
    { role: "citizen" },
  );
  assertScrieBlocata(r, "T8: administratorul și-a modificat propriul rând!");
});

test("T14 — staff A NU poate administra utilizatori", async () => {
  const r = await rest(
    "PATCH",
    `tenant_users?user_id=eq.${ids["a_citizen@test.ro"]}`,
    tok.a_staff,
    { role: "staff" },
  );
  assertScrieBlocata(r, "T14: un staff a administrat utilizatori!");
});

// ---------------------------------------------------------------------------
// Cross-tenant — atacurile care contează
// ---------------------------------------------------------------------------

test("T9 — tenant_admin A NU poate schimba rolul unui utilizator al lui B", async () => {
  const r = await rest(
    "PATCH",
    `tenant_users?user_id=eq.${ids["b_citizen@test.ro"]}`,
    tok.a_admin,
    { role: "tenant_admin" },
  );
  assertScrieBlocata(
    r,
    "T9: admin al lui A a modificat un utilizator al lui B!",
  );
});

test("T10 — MUTAREA RÂNDULUI: admin A nu poate seta tenant_id = B (WITH CHECK)", async () => {
  const r = await rest(
    "PATCH",
    `tenant_users?user_id=eq.${ids["a_citizen@test.ro"]}`,
    tok.a_admin,
    { tenant_id: ids.suceava },
  );
  assertScrieBlocata(
    r,
    "T10: un rând a fost MUTAT în alt tenant. Aceasta este breșa pe care WITH CHECK o oprește.",
  );

  const client = await db();
  const { rows } = await client.query(
    `select tenant_id from public.tenant_users where user_id = $1;`,
    [ids["a_citizen@test.ro"]],
  );
  await client.end();
  assert.equal(
    rows[0].tenant_id,
    ids.botosani,
    "T10: rândul chiar a traversat frontiera!",
  );
});

test("T11 — tenant_admin A NU poate ACORDA un rol în tenantul B (INSERT cross-tenant)", async () => {
  const r = await rest("POST", "tenant_users", tok.a_admin, {
    user_id: ids["nobody@test.ro"],
    tenant_id: ids.suceava,
    role: "tenant_admin",
  });
  assertScrieBlocata(
    r,
    "T11: admin al lui A a creat un administrator în tenantul B!",
  );
});

test("T12 — tenant_admin A NU poate modifica brandingul primăriei B", async () => {
  const r = await rest("PATCH", `tenants?id=eq.${ids.suceava}`, tok.a_admin, {
    display_name: "HACKED",
  });
  assertScrieBlocata(r, "T12: admin al lui A a modificat primăria B!");

  const client = await db();
  const { rows } = await client.query(
    `select display_name from public.tenants where id = $1;`,
    [ids.suceava],
  );
  await client.end();
  assert.equal(rows[0].display_name, "Primaria Suceava");
});

test("T13 — DELETE nu este acordat nimănui pe tenant_users", async () => {
  const r = await rest(
    "DELETE",
    `tenant_users?user_id=eq.${ids["b_citizen@test.ro"]}`,
    tok.a_admin,
  );
  assert.ok(
    r.status === 403 || r.status === 401,
    `T13: DELETE nu a fost refuzat la nivel de privilegiu (HTTP ${r.status})`,
  );
});

// ---------------------------------------------------------------------------
// Fără claim-uri => fără acces
// ---------------------------------------------------------------------------

test("T15 — utilizator FĂRĂ rând în tenant_users nu citește nimic din tenant_users", async () => {
  const r = await rest("GET", "tenant_users?select=user_id", tok.nobody);
  assert.deepEqual(r.body, []);
});

test("T16 — utilizator FĂRĂ rând nu citește nimic din tenants", async () => {
  const r = await rest("GET", "tenants?select=slug", tok.nobody);
  assert.deepEqual(r.body, []);
});

test("T17 — anonim, fără JWT: niciun acces", async () => {
  const r = await restAnon("tenants?select=slug");
  assert.ok(
    r.status === 401 || r.status === 403,
    `T17: vizitatorul anonim a primit HTTP ${r.status} — ar trebui refuzat.`,
  );
});

// ---------------------------------------------------------------------------
// Controale pozitive — sistemul nu trebuie să fie „închis pentru că e rupt"
// ---------------------------------------------------------------------------

test("T18 — CONTROL POZITIV: tenant_admin B își vede proprii utilizatori", async () => {
  const r = await rest("GET", "tenant_users?select=tenant_id", tok.b_admin);
  assert.equal(r.body.length, 2);
  for (const row of r.body) assert.equal(row.tenant_id, ids.suceava);
});

test("T19 — CONTROL POZITIV: admin A promovează legitim un citizen al lui A la staff", async () => {
  const r = await rest(
    "PATCH",
    `tenant_users?user_id=eq.${ids["a_citizen@test.ro"]}`,
    tok.a_admin,
    { role: "staff" },
  );
  assert.equal(r.status, 200);
  assert.equal(
    r.body.length,
    1,
    "promovarea legitimă a eșuat — RLS e prea strict",
  );
  assert.equal(r.body[0].role, "staff");
});

test("T20 — CONTROL POZITIV: claim-urile ajung în app_metadata, nu în user_metadata", async () => {
  const [, payload] = tok.a_admin.split(".");
  const claims = JSON.parse(
    Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString(),
  );

  assert.equal(claims.app_metadata.app_role, "tenant_admin");
  assert.equal(claims.app_metadata.tenant_id, ids.botosani);
  assert.equal(
    claims.user_metadata.app_role,
    undefined,
    "rolul a apărut în user_metadata!",
  );
  assert.equal(
    claims.user_metadata.tenant_id,
    undefined,
    "tenantul a apărut în user_metadata!",
  );
  assert.equal(
    claims.role,
    "authenticated",
    "claims.role (PostgREST) a fost suprascris!",
  );
});
