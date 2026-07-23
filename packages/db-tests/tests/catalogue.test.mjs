// Verificările structurale (C*) din ADR-0002 și ADR-0003.
//
// Acestea sunt porțile care supraviețuiesc schimbării de echipă. Un test de
// izolare dovedește că politicile de AZI sunt corecte. C1 dovedește că politicile
// de MÂINE nu pot lipsi cu totul.

import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/harness.mjs";

const APPROVED_ROLES = ["citizen", "staff", "leadership", "tenant_admin"];

// Roluri interzise: super-adminul, sub orice nume (ADR-0002, decizia 11).
const FORBIDDEN_ROLE_PATTERN =
  /super|platform|support|admin_all|root|god|owner|superuser/i;

test("C1 — fiecare tabel cu tenant_id are RLS activat, FORCE activat și cel puțin o politică", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select c.relname                       as tabel,
             c.relrowsecurity                as rls_enabled,
             c.relforcerowsecurity           as rls_forced,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as politici
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and exists (
           select 1 from information_schema.columns col
            where col.table_schema = 'public'
              and col.table_name   = c.relname
              and col.column_name  = 'tenant_id'
         )
       order by c.relname;
    `);

    // Dacă nu există niciun tabel cu tenant_id, C1 nu are ce apăra — și asta
    // este ea însăși o eroare: schema de tenancy trebuie să existe.
    assert.ok(rows.length > 0, "niciun tabel cu tenant_id — schema lipsește?");

    const vinovate = rows.filter(
      (r) => !r.rls_enabled || !r.rls_forced || Number(r.politici) === 0,
    );

    assert.deepEqual(
      vinovate,
      [],
      `C1 ÎNCĂLCAT — tabele cu tenant_id fără RLS/FORCE/politici:\n` +
        vinovate
          .map(
            (r) =>
              `  ${r.tabel}: rls=${r.rls_enabled} force=${r.rls_forced} politici=${r.politici}`,
          )
          .join("\n"),
    );
  } finally {
    await client.end();
  }
});

test("C1b — niciun tabel din public nu rămâne fără RLS (chiar și fără tenant_id)", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select c.relname as tabel, c.relrowsecurity as rls_enabled
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and not c.relrowsecurity
       order by c.relname;
    `);

    assert.deepEqual(
      rows.map((r) => r.tabel),
      [],
      `Tabel(e) în public FĂRĂ RLS. Un tabel nou fără RLS este deschis, nu închis.\n` +
        `Dacă tabelul este intenționat public, adaugă-l explicit la excepții — nu ignora testul.`,
    );
  } finally {
    await client.end();
  }
});

test("C2 — nicio politică pentru `authenticated` nu are USING(true) sau WITH CHECK(true)", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select tablename, policyname, cmd, qual, with_check
        from pg_policies
       where schemaname = 'public'
         and 'authenticated' = any (roles)
         and (btrim(coalesce(qual, '')) = 'true'
           or btrim(coalesce(with_check, '')) = 'true');
    `);

    assert.deepEqual(
      rows.map((r) => `${r.tablename}.${r.policyname}`),
      [],
      "C2 ÎNCĂLCAT — politică permisivă necondiționat pentru utilizatori autentificați.",
    );
  } finally {
    await client.end();
  }
});

test("C3 — fiecare politică FOR UPDATE are WITH CHECK, nu doar USING", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select tablename, policyname
        from pg_policies
       where schemaname = 'public'
         and cmd = 'UPDATE'
         and with_check is null;
    `);

    assert.deepEqual(
      rows.map((r) => `${r.tablename}.${r.policyname}`),
      [],
      "C3 ÎNCĂLCAT — UPDATE fără WITH CHECK. USING filtrează rândul de INTRARE; " +
        "fără WITH CHECK, un utilizator mută rândul în alt tenant setând tenant_id. " +
        "Este bug de securitate, nu omisiune stilistică.",
    );
  } finally {
    await client.end();
  }
});

test("C4 — rolul `anon` nu are INSERT/UPDATE/DELETE pe niciun tabel din public", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select table_name, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee = 'anon'
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
    `);

    assert.deepEqual(
      rows.map((r) => `${r.table_name}:${r.privilege_type}`),
      [],
      "C4 ÎNCĂLCAT — `anon` are drept de scriere. Vizitatorul anonim nu scrie niciodată.",
    );
  } finally {
    await client.end();
  }
});

test("C6 — fiecare tabel cu tenant_id are un index cu tenant_id pe prima poziție", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      with tenant_tables as (
        select table_name
          from information_schema.columns
         where table_schema = 'public' and column_name = 'tenant_id'
      )
      select t.table_name
        from tenant_tables t
       where not exists (
         select 1
           from pg_index i
           join pg_class c   on c.oid = i.indrelid
           join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
          where c.relname = t.table_name
            and a.attname = 'tenant_id'
       );
    `);

    assert.deepEqual(
      rows.map((r) => r.table_name),
      [],
      "C6 ÎNCĂLCAT — tabel cu tenant_id fără index care începe cu tenant_id.",
    );
  } finally {
    await client.end();
  }
});

test("C10 — hook-ul nu citește rolul/tenantul din user_metadata sau din input de client", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select prosrc from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'custom_access_token_hook';
    `);

    assert.equal(rows.length, 1, "hook-ul custom_access_token_hook nu există");
    const src = rows[0].prosrc;

    assert.ok(
      !/user_metadata/i.test(src),
      "C10 ÎNCĂLCAT — hook-ul referă `user_metadata`, care este scriptibil de client.",
    );
    assert.ok(
      /from\s+public\.tenant_users/i.test(src),
      "C10 ÎNCĂLCAT — hook-ul nu citește din tenant_users, singura sursă de adevăr.",
    );
  } finally {
    await client.end();
  }
});

test("C11 — politicile de scriere pe tenant_users au toate trei predicatele", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies
       where schemaname = 'public'
         and tablename  = 'tenant_users'
         and cmd in ('INSERT', 'UPDATE')
         and 'authenticated' = any (roles);
    `);

    assert.ok(rows.length > 0, "nicio politică de scriere pe tenant_users?");

    for (const p of rows) {
      assert.ok(
        /current_tenant_id/.test(p.expr),
        `C11 ÎNCĂLCAT — ${p.policyname} (${p.cmd}) nu are predicat de TENANT.`,
      );
      assert.ok(
        /has_role\('tenant_admin'/.test(p.expr),
        `C11 ÎNCĂLCAT — ${p.policyname} (${p.cmd}) nu cere rolul tenant_admin.`,
      );
      assert.ok(
        /user_id <> /.test(p.expr),
        `C11 ÎNCĂLCAT — ${p.policyname} (${p.cmd}) nu împiedică modificarea propriului rând.`,
      );
    }
  } finally {
    await client.end();
  }
});

test("C12 — rolul este enum app_role, nu coloană `text` liberă", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select table_name, data_type, udt_name
        from information_schema.columns
       where table_schema = 'public' and column_name = 'role';
    `);

    assert.ok(rows.length > 0, "nu există nicio coloană `role`");
    for (const r of rows) {
      assert.equal(
        r.udt_name,
        "app_role",
        `C12 ÎNCĂLCAT — ${r.table_name}.role este ${r.data_type}, nu enum app_role. ` +
          `Un rol de tip text liber acceptă tăcut orice valoare.`,
      );
    }
  } finally {
    await client.end();
  }
});

test("C13 — app_role conține EXACT cele patru valori aprobate; niciun super-admin", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select e.enumlabel as rol
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'app_role'
       order by e.enumsortorder;
    `);

    const roluri = rows.map((r) => r.rol);

    assert.deepEqual(
      roluri,
      APPROVED_ROLES,
      `C13 ÎNCĂLCAT — setul de roluri s-a schimbat.\n` +
        `  aprobat: ${APPROVED_ROLES.join(", ")}\n` +
        `  găsit:   ${roluri.join(", ")}\n` +
        `Setul de roluri este ÎNCHIS (ADR-0003). Un rol nou cere un ADR, nu o migrație.`,
    );

    const interzise = roluri.filter((r) => FORBIDDEN_ROLE_PATTERN.test(r));
    assert.deepEqual(
      interzise,
      [],
      `C13 ÎNCĂLCAT — rol de tip super-admin reintrodus: ${interzise.join(", ")}.\n` +
        `Interdicția super-adminului (ADR-0002, decizia 11) nu se reintroduce sub niciun nume.`,
    );
  } finally {
    await client.end();
  }
});

// Tabelele de istoric sunt append-only IMPUS LA NIVEL DE PRIVILEGIU, nu doar prin
// convenție: un client nu poate fabrica sau șterge un rând de istoric prin PostgREST,
// pentru că `authenticated` nu are nici GRANT, nici politică de INSERT/UPDATE/DELETE.
// Singurul scriitor legitim este funcția SECURITY DEFINER (ADR-0004). Fără această poartă,
// istoricul devine falsificabil (ADR-0004, „Opțiunea B respinsă").
test("C14 — tabelele de istoric NU au GRANT sau politici de scriere pentru `authenticated`", async () => {
  const HISTORY_TABLES = ["issue_status_history", "issue_assignment_history"];
  const client = await db();
  try {
    const { rows: grants } = await client.query(
      `
      select table_name, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee = 'authenticated'
         and table_name = any ($1)
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
    `,
      [HISTORY_TABLES],
    );

    assert.deepEqual(
      grants.map((r) => `${r.table_name}:${r.privilege_type}`),
      [],
      "C14 ÎNCĂLCAT — istoricul are GRANT de scriere pentru `authenticated`. " +
        "Append-only-ul trebuie impus la nivel de privilegiu, nu doar de politică.",
    );

    const { rows: policies } = await client.query(
      `
      select tablename, policyname, cmd
        from pg_policies
       where schemaname = 'public'
         and tablename = any ($1)
         and 'authenticated' = any (roles)
         and cmd in ('INSERT', 'UPDATE', 'DELETE');
    `,
      [HISTORY_TABLES],
    );

    assert.deepEqual(
      policies.map((r) => `${r.tablename}.${r.policyname} (${r.cmd})`),
      [],
      "C14 ÎNCĂLCAT — istoricul are politică de scriere pentru `authenticated`. " +
        "Scrierea trece EXCLUSIV prin funcția SECURITY DEFINER (ADR-0004).",
    );
  } finally {
    await client.end();
  }
});

// C15 este pentru funcțiile SECURITY DEFINER ce a fost C1 pentru tabele: transformă
// „am uitat `set search_path` / `revoke execute`" dintr-o breșă tăcută într-un build roșu,
// pentru fiecare funcție definer VIITOARE, nu doar pentru cele două de acum. La SECURITY
// DEFINER, un search_path needeclarat este o cale de escaladare de privilegii, iar un
// EXECUTE lăsat lui anon/PUBLIC deschide gaura oricui (ADR-0004, Decizie pct. 1–2, 4).
test("C15 — orice funcție SECURITY DEFINER din public are search_path fixat și niciun EXECUTE pentru anon/PUBLIC", async () => {
  const client = await db();
  try {
    const { rows } = await client.query(`
      select p.proname as functie,
             exists (
               select 1
                 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
                where cfg like 'search_path=%'
             ) as has_search_path,
             coalesce((
               select bool_or(a.grantee = 0 or r.rolname = 'anon')
                 from aclexplode(p.proacl) a
                 left join pg_roles r on r.oid = a.grantee
                where a.privilege_type = 'EXECUTE'
             ), false) as anon_or_public_can_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef = true
       order by p.proname;
    `);

    const fara_search_path = rows
      .filter((r) => !r.has_search_path)
      .map((r) => r.functie);
    assert.deepEqual(
      fara_search_path,
      [],
      `C15 ÎNCĂLCAT — funcție SECURITY DEFINER fără search_path fixat: ${fara_search_path.join(", ")}.\n` +
        `La definer, search_path needeclarat este cale de escaladare de privilegii (ADR-0004).`,
    );

    const executabile_de_anon = rows
      .filter((r) => r.anon_or_public_can_execute)
      .map((r) => r.functie);
    assert.deepEqual(
      executabile_de_anon,
      [],
      `C15 ÎNCĂLCAT — funcție SECURITY DEFINER executabilă de anon/PUBLIC: ${executabile_de_anon.join(", ")}.\n` +
        `PostgreSQL acordă EXECUTE lui PUBLIC implicit; trebuie revocat (ADR-0004, Decizie pct. 4).`,
    );
  } finally {
    await client.end();
  }
});
