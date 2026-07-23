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
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import {
  db,
  login,
  rest,
  restAnon,
  rpc,
  seed,
  seedIssues,
} from "../src/harness.mjs";

let ids;
let sez; // ids ale categoriilor și sesizărilor semănate
const tok = {};

before(async () => {
  ids = await seed();
  sez = await seedIssues(ids);
  for (const who of [
    "a_citizen",
    "a_staff",
    "a_leadership",
    "a_admin",
    "b_citizen",
    "b_admin",
    "nobody",
  ]) {
    tok[who] = await login(`${who}@test.ro`);
  }
});

/** Citește statusul stocat al unei sesizări (ca postgres — verificare de stare, nu de izolare). */
async function storedStatus(issueId) {
  const client = await db();
  try {
    const { rows } = await client.query(
      `select status from public.issues where id = $1;`,
      [issueId],
    );
    return rows[0]?.status;
  } finally {
    await client.end();
  }
}

/** Numărul de rânduri de istoric de status pentru o sesizare. */
async function statusHistoryCount(issueId) {
  const client = await db();
  try {
    const { rows } = await client.query(
      `select count(*)::int as n from public.issue_status_history where issue_id = $1;`,
      [issueId],
    );
    return rows[0].n;
  } finally {
    await client.end();
  }
}

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
  // botosani: a_citizen, a_staff, a_leadership, a_admin
  assert.equal(r.body.length, 4);
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

// ===========================================================================
// Sesizări — izolare cross-tenant și cross-rol (T46–T66)
// Spec §23.2 + ADR-0004 §Plan de validare. Verificările pe funcțiile de workflow
// se fac pe STAREA STOCATĂ (status + număr de rânduri de istoric), nu pe codul HTTP
// (nota RLS `200 []`); refuzul unei funcții este o excepție => status >= 400.
// ===========================================================================

/** O funcție de workflow a REFUZAT: excepție clasificată => niciun 2xx. */
function assertRpcRefuzat(res, mesaj) {
  assert.ok(
    res.status >= 400,
    `${mesaj}\n  A REUȘIT în loc să refuze: HTTP ${res.status} ${JSON.stringify(res.body)}`,
  );
}

async function storedAssignee(issueId) {
  const client = await db();
  try {
    const { rows } = await client.query(
      `select assigned_to from public.issues where id = $1;`,
      [issueId],
    );
    return rows[0]?.assigned_to ?? null;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Citire issues — confidențialitate între cetățenii aceluiași tenant
// ---------------------------------------------------------------------------

test("T46 — citizen A vede DOAR propriile sesizări, nu ale altui cetățean din același tenant", async () => {
  const r = await rest("GET", "issues?select=id,author_user_id", tok.a_citizen);
  assert.equal(r.status, 200);
  for (const row of r.body) {
    assert.equal(
      row.author_user_id,
      ids["a_citizen@test.ro"],
      "T46: citizen A a văzut o sesizare care nu e a lui!",
    );
  }
  const vazute = r.body.map((x) => x.id);
  assert.ok(
    vazute.includes(sez.issue.a_own),
    "T46: nu-și vede propria sesizare",
  );
  assert.ok(
    !vazute.includes(sez.issue.a_other),
    "T46: vede sesizarea altui cetățean (a_staff) din același tenant!",
  );
});

test("T47 — citizen A cere EXPLICIT id-ul sesizării altui cetățean (același tenant): 0 rânduri", async () => {
  const r = await rest(
    "GET",
    `issues?id=eq.${sez.issue.a_other}&select=id`,
    tok.a_citizen,
  );
  assert.deepEqual(r.body, []);
});

test("T48 — citizen A NU poate falsifica autorul la INSERT", async () => {
  const r = await rest("POST", "issues", tok.a_citizen, {
    category_id: sez.cat.botosani,
    description: "autor fals",
    location_lat: 47.7,
    location_lng: 26.6,
    client_submission_id: randomUUID(),
    author_user_id: ids["a_staff@test.ro"],
  });
  // Coloana `author_user_id` nu e acordată la INSERT (privilegiu) și WITH CHECK o prinde.
  assertScrieBlocata(
    r,
    "T48: un cetățean a creat o sesizare în numele altcuiva!",
  );
});

test("T49 — citizen A NU poate insera o sesizare în tenantul B", async () => {
  const r = await rest("POST", "issues", tok.a_citizen, {
    category_id: sez.cat.botosani,
    description: "tenant fals",
    location_lat: 47.7,
    location_lng: 26.6,
    client_submission_id: randomUUID(),
    tenant_id: ids.suceava,
  });
  assertScrieBlocata(r, "T49: o sesizare a fost creată în alt tenant!");
});

test("T-submit — CONTROL POZITIV: citizen A depune o sesizare validă", async () => {
  const r = await rest("POST", "issues", tok.a_citizen, {
    category_id: sez.cat.botosani,
    description: "sesizare validă",
    location_lat: 47.75,
    location_lng: 26.67,
    client_submission_id: randomUUID(),
  });
  assert.equal(
    r.status,
    201,
    `depunerea validă a eșuat: ${JSON.stringify(r.body)}`,
  );
  assert.equal(r.body[0].author_user_id, ids["a_citizen@test.ro"]);
  assert.equal(r.body[0].tenant_id, ids.botosani);
  assert.equal(r.body[0].status, "received");
});

test("T-idem — idempotență: două INSERT cu același client_submission_id produc o singură sesizare (FR-008)", async () => {
  const csid = randomUUID();
  const body = {
    category_id: sez.cat.botosani,
    description: "idempotent",
    location_lat: 47.75,
    location_lng: 26.67,
    client_submission_id: csid,
  };
  const r1 = await rest("POST", "issues", tok.a_citizen, body);
  assert.equal(r1.status, 201);
  const r2 = await rest("POST", "issues", tok.a_citizen, body);
  assert.equal(
    r2.status,
    409,
    "a doua trimitere ar trebui să lovească unique-ul",
  );

  const client = await db();
  const { rows } = await client.query(
    `select count(*)::int as n from public.issues where client_submission_id = $1;`,
    [csid],
  );
  await client.end();
  assert.equal(
    rows[0].n,
    1,
    "T-idem: s-au creat două sesizări pentru aceeași încercare!",
  );
});

test("T51 — staff A vede toate sesizările lui A și NICIUNA a lui B", async () => {
  const r = await rest("GET", "issues?select=id,tenant_id", tok.a_staff);
  assert.equal(r.status, 200);
  assert.ok(
    r.body.length >= 8,
    "staff A ar trebui să vadă toate sesizările tenantului",
  );
  for (const row of r.body) {
    assert.equal(
      row.tenant_id,
      ids.botosani,
      "T51: staff A a văzut o sesizare a altui tenant!",
    );
  }
  const vazute = r.body.map((x) => x.id);
  assert.ok(
    !vazute.includes(sez.issue.b_own),
    "T51: staff A vede o sesizare a lui B!",
  );
});

// ---------------------------------------------------------------------------
// change_issue_status — autorizare, tranziții, concurență
// ---------------------------------------------------------------------------

test("T52 — citizen A NU poate schimba statusul (nici pe sesizarea proprie)", async () => {
  const r = await rpc("change_issue_status", tok.a_citizen, {
    p_issue_id: sez.issue.a_own,
    p_expected_status: "received",
    p_to_status: "in_progress",
  });
  assertRpcRefuzat(r, "T52: un cetățean a schimbat statusul!");
  assert.equal(await storedStatus(sez.issue.a_own), "received");
  assert.equal(await statusHistoryCount(sez.issue.a_own), 0);
});

test("T53 — leadership A NU poate schimba statusul sau atribui (has_role('staff') = false)", async () => {
  const r1 = await rpc("change_issue_status", tok.a_leadership, {
    p_issue_id: sez.issue.a_own,
    p_expected_status: "received",
    p_to_status: "in_progress",
  });
  assertRpcRefuzat(r1, "T53: leadership a schimbat statusul!");

  const r2 = await rpc("assign_issue", tok.a_leadership, {
    p_issue_id: sez.issue.a_own,
    p_assignee: ids["a_staff@test.ro"],
  });
  assertRpcRefuzat(r2, "T53: leadership a atribuit o sesizare!");

  assert.equal(await storedStatus(sez.issue.a_own), "received");
  assert.equal(await statusHistoryCount(sez.issue.a_own), 0);
  assert.equal(await storedAssignee(sez.issue.a_own), null);
});

test("T54 — staff A: received→in_progress→resolved; exact DOUĂ rânduri de istoric, în ordine", async () => {
  const r1 = await rpc("change_issue_status", tok.a_staff, {
    p_issue_id: sez.issue.a_flow,
    p_expected_status: "received",
    p_to_status: "in_progress",
  });
  assert.equal(
    r1.status,
    200,
    `prima tranziție a eșuat: ${JSON.stringify(r1.body)}`,
  );

  const r2 = await rpc("change_issue_status", tok.a_staff, {
    p_issue_id: sez.issue.a_flow,
    p_expected_status: "in_progress",
    p_to_status: "resolved",
  });
  assert.equal(
    r2.status,
    200,
    `a doua tranziție a eșuat: ${JSON.stringify(r2.body)}`,
  );

  assert.equal(await storedStatus(sez.issue.a_flow), "resolved");
  assert.equal(await statusHistoryCount(sez.issue.a_flow), 2);

  const client = await db();
  const { rows } = await client.query(
    `select from_status, to_status, actor_user_id, actor_role, acting_as
       from public.issue_status_history
      where issue_id = $1 order by created_at;`,
    [sez.issue.a_flow],
  );
  await client.end();

  assert.deepEqual(
    rows.map((x) => [x.from_status, x.to_status]),
    [
      ["received", "in_progress"],
      ["in_progress", "resolved"],
    ],
  );
  for (const row of rows) {
    assert.equal(row.actor_user_id, ids["a_staff@test.ro"]);
    assert.equal(row.actor_role, "staff");
    assert.equal(row.acting_as, "official");
  }
});

test("T55 — staff A: expected_status greșit => refuz determinist, fără rând nou (E13)", async () => {
  const r = await rpc("change_issue_status", tok.a_staff, {
    p_issue_id: sez.issue.a_stale,
    p_expected_status: "in_progress", // real e 'received'
    p_to_status: "resolved",
  });
  assertRpcRefuzat(r, "T55: o tranziție cu expected greșit a reușit!");
  assert.equal(await storedStatus(sez.issue.a_stale), "received");
  assert.equal(await statusHistoryCount(sez.issue.a_stale), 0);
});

test("T56 — staff A: tranziție interzisă (received→resolved) => refuz; status neschimbat", async () => {
  const r = await rpc("change_issue_status", tok.a_staff, {
    p_issue_id: sez.issue.a_forbid,
    p_expected_status: "received",
    p_to_status: "resolved",
  });
  assertRpcRefuzat(
    r,
    "T56: o tranziție interzisă (sărirea peste in_progress) a reușit!",
  );
  assert.equal(await storedStatus(sez.issue.a_forbid), "received");
  assert.equal(await statusHistoryCount(sez.issue.a_forbid), 0);
});

test("T57 — istoricul de status este append-only: UPDATE/DELETE direct refuzat, rândul neschimbat", async () => {
  // Creează un rând real de istoric prin funcție, apoi încearcă să-l falsifice.
  const t = await rpc("change_issue_status", tok.a_staff, {
    p_issue_id: sez.issue.a_t57,
    p_expected_status: "received",
    p_to_status: "in_progress",
  });
  assert.equal(t.status, 200);

  const client = await db();
  const { rows } = await client.query(
    `select id, to_status from public.issue_status_history where issue_id = $1;`,
    [sez.issue.a_t57],
  );
  await client.end();
  assert.equal(rows.length, 1);
  const histId = rows[0].id;

  const upd = await rest(
    "PATCH",
    `issue_status_history?id=eq.${histId}`,
    tok.a_admin,
    { to_status: "resolved" },
  );
  assertScrieBlocata(upd, "T57: un rând de istoric a fost modificat!");

  const del = await rest(
    "DELETE",
    `issue_status_history?id=eq.${histId}`,
    tok.a_admin,
  );
  assert.ok(
    del.status === 403 || del.status === 401,
    `T57: DELETE pe istoric nu a fost refuzat la privilegiu (HTTP ${del.status})`,
  );

  const client2 = await db();
  const { rows: after } = await client2.query(
    `select to_status from public.issue_status_history where id = $1;`,
    [histId],
  );
  await client2.end();
  assert.equal(
    after[0].to_status,
    "in_progress",
    "T57: rândul de istoric s-a schimbat!",
  );
});

test("T58 — citizen A NU vede istoricul sesizării altui cetățean (același tenant); staff DA", async () => {
  const rCit = await rest(
    "GET",
    `issue_status_history?issue_id=eq.${sez.issue.a_other}&select=id`,
    tok.a_citizen,
  );
  assert.deepEqual(
    rCit.body,
    [],
    "T58: citizen A a văzut istoricul altui cetățean!",
  );

  // Control pozitiv: rolul elevat vede istoricul (rândul semănat există cu adevărat).
  const rStaff = await rest(
    "GET",
    `issue_status_history?issue_id=eq.${sez.issue.a_other}&select=id`,
    tok.a_staff,
  );
  assert.ok(
    rStaff.body.length >= 1,
    "T58: staff nu vede istoricul tenantului?",
  );
});

// ---------------------------------------------------------------------------
// assign_issue — atribuire, izolare de tenant a assignee-ului
// ---------------------------------------------------------------------------

test("T59 — staff A atribuie unui utilizator activ din A: reușește, istoric + proiecție actualizate", async () => {
  const r = await rpc("assign_issue", tok.a_staff, {
    p_issue_id: sez.issue.a_assign,
    p_assignee: ids["a_leadership@test.ro"],
  });
  assert.ok(
    r.status === 200 || r.status === 204,
    `T59: atribuirea legitimă a eșuat: HTTP ${r.status} ${JSON.stringify(r.body)}`,
  );
  assert.equal(
    await storedAssignee(sez.issue.a_assign),
    ids["a_leadership@test.ro"],
  );

  const client = await db();
  const { rows } = await client.query(
    `select previous_assignee, new_assignee, actor_role, acting_as
       from public.issue_assignment_history where issue_id = $1 order by created_at;`,
    [sez.issue.a_assign],
  );
  await client.end();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].previous_assignee, null);
  assert.equal(rows[0].new_assignee, ids["a_leadership@test.ro"]);
  assert.equal(rows[0].actor_role, "staff");
  assert.equal(rows[0].acting_as, "official");
});

test("T60 — staff A NU poate atribui unui utilizator al lui B (assignee cross-tenant)", async () => {
  const r = await rpc("assign_issue", tok.a_staff, {
    p_issue_id: sez.issue.a_assign,
    p_assignee: ids["b_citizen@test.ro"],
  });
  assertRpcRefuzat(
    r,
    "T60: o sesizare a fost atribuită unui utilizator al altui tenant!",
  );
  // Atribuirea rămâne cea legitimă din T59, neschimbată.
  assert.equal(
    await storedAssignee(sez.issue.a_assign),
    ids["a_leadership@test.ro"],
  );
});

// ---------------------------------------------------------------------------
// issue_categories — izolare de tenant, fără scriere de client
// ---------------------------------------------------------------------------

test("T61 — citizen A NU poate scrie în issue_categories", async () => {
  const ins = await rest("POST", "issue_categories", tok.a_citizen, {
    code: "apa",
    label: "Apă",
  });
  assertScrieBlocata(ins, "T61: un cetățean a creat o categorie!");

  const upd = await rest(
    "PATCH",
    `issue_categories?id=eq.${sez.cat.botosani}`,
    tok.a_citizen,
    { is_active: false },
  );
  assertScrieBlocata(upd, "T61: un cetățean a modificat o categorie!");
});

test("T62 — A cere EXPLICIT categoriile lui B: 0 rânduri", async () => {
  const r = await rest(
    "GET",
    `issue_categories?tenant_id=eq.${ids.suceava}&select=id`,
    tok.a_staff,
  );
  assert.deepEqual(r.body, [], "T62: A a văzut categoriile lui B!");
});

// ---------------------------------------------------------------------------
// Control pozitiv de auto-procesare (R-006) + izolarea funcțiilor (T64–T66)
// ---------------------------------------------------------------------------

test("T63 — CONTROL POZITIV: staff creează o sesizare ca cetățean; auto-procesarea e ÎNREGISTRATĂ", async () => {
  const create = await rest("POST", "issues", tok.a_staff, {
    category_id: sez.cat.botosani,
    description: "staff ca cetățean",
    location_lat: 47.7,
    location_lng: 26.6,
    client_submission_id: randomUUID(),
  });
  assert.equal(create.status, 201);
  const newId = create.body[0].id;
  assert.equal(create.body[0].author_user_id, ids["a_staff@test.ro"]);

  // Funcționarul își procesează propria sesizare: nu se blochează, se înregistrează (OQ-013).
  const tr = await rpc("change_issue_status", tok.a_staff, {
    p_issue_id: newId,
    p_expected_status: "received",
    p_to_status: "in_progress",
  });
  assert.equal(tr.status, 200);

  const client = await db();
  const { rows } = await client.query(
    `select actor_user_id, actor_role, acting_as from public.issue_status_history where issue_id = $1;`,
    [newId],
  );
  await client.end();
  assert.equal(rows[0].actor_role, "staff");
  assert.equal(rows[0].acting_as, "official");
  assert.equal(
    rows[0].actor_user_id,
    ids["a_staff@test.ro"],
    "T63: auto-procesarea (actor = autor) trebuie derivabilă din date",
  );
});

test("T64 — staff A NU poate muta/atribui o sesizare a lui B, deși funcția e SECURITY DEFINER", async () => {
  const r1 = await rpc("change_issue_status", tok.a_staff, {
    p_issue_id: sez.issue.b_own,
    p_expected_status: "received",
    p_to_status: "in_progress",
  });
  assertRpcRefuzat(
    r1,
    "T64: staff A a schimbat statusul unei sesizări a lui B!",
  );

  const r2 = await rpc("assign_issue", tok.a_staff, {
    p_issue_id: sez.issue.b_own,
    p_assignee: ids["a_staff@test.ro"],
  });
  assertRpcRefuzat(r2, "T64: staff A a atribuit o sesizare a lui B!");

  // Starea lui B, neatinsă — izolarea ține deși RLS nu mai e plasa de siguranță.
  assert.equal(await storedStatus(sez.issue.b_own), "received");
  assert.equal(await statusHistoryCount(sez.issue.b_own), 0);
  assert.equal(await storedAssignee(sez.issue.b_own), null);

  const client = await db();
  const { rows } = await client.query(
    `select count(*)::int as n from public.issue_assignment_history where issue_id = $1;`,
    [sez.issue.b_own],
  );
  await client.end();
  assert.equal(
    rows[0].n,
    0,
    "T64: s-a scris un rând de atribuire în tenantul B!",
  );
});

test("T65 — anon (fără JWT) NU poate invoca funcțiile de workflow (EXECUTE revocat)", async () => {
  const r1 = await rpc("change_issue_status", null, {
    p_issue_id: sez.issue.a_own,
    p_expected_status: "received",
    p_to_status: "in_progress",
  });
  assertRpcRefuzat(r1, "T65: anon a invocat change_issue_status!");

  const r2 = await rpc("assign_issue", null, {
    p_issue_id: sez.issue.a_own,
    p_assignee: ids["a_staff@test.ro"],
  });
  assertRpcRefuzat(r2, "T65: anon a invocat assign_issue!");

  assert.equal(await storedStatus(sez.issue.a_own), "received");
  assert.equal(await statusHistoryCount(sez.issue.a_own), 0);
});

test("T66 — concurență: două apeluri simultane, EXACT unul reușește, un singur rând de istoric", async () => {
  const call = () =>
    rpc("change_issue_status", tok.a_staff, {
      p_issue_id: sez.issue.a_t66,
      p_expected_status: "received",
      p_to_status: "in_progress",
    });

  const [ra, rb] = await Promise.all([call(), call()]);
  const reusite = [ra, rb].filter((x) => x.status === 200).length;
  assert.equal(
    reusite,
    1,
    `T66: ${reusite} apeluri au reușit (așteptat exact 1). ` +
      `FOR UPDATE + expected_status trebuie să serializeze.`,
  );
  assert.equal(await storedStatus(sez.issue.a_t66), "in_progress");
  assert.equal(await statusHistoryCount(sez.issue.a_t66), 1);
});
