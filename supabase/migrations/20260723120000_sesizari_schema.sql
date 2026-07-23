-- Migrația 004 — nucleul de sesizări cetățenești (depunere, urmărire, inbox, istoric).
--
-- Sursa deciziilor:
--   Spec „Sesizări cetățenești — nucleul" (docs/architecture/specs/sesizari-cetatenesti.md), §7–§12, §21
--   ADR-0002 — izolarea de tenant ca frontieră de securitate, deny by default, FORCE RLS
--   ADR-0003 — predicatul de rol (has_role), coloane sensibile scoase din GRANT
--   ADR-0004 — funcțiile de workflow change_issue_status / assign_issue (SECURITY DEFINER)
--
-- guard-approved: ADR-0004
--
-- Markerul de mai sus autorizează cele două `SECURITY DEFINER` din această migrație
-- (scripts/check-migrations.mjs). ADR-0004 este `Accepted`; autonomy.md #3 este satisfăcută.
--
-- Patru tabele noi cu `tenant_id`, toate sub tiparul ADR-0002/0003: RLS + FORCE + politici
-- în ACEEAȘI migrație (C1), index cu `tenant_id` pe prima poziție (C6), predicatul de rol
-- legat prin AND de predicatul de tenant (C8). Istoricul este append-only IMPUS LA NIVEL DE
-- PRIVILEGIU (C14): nicio politică și niciun GRANT de scriere pentru `authenticated`. Singurul
-- scriitor legitim al proiecției de status/atribuire și al istoricului este funcția
-- SECURITY DEFINER, îngustă și verificată (ADR-0004).


-- ===========================================================================
-- 1. Tipuri închise (enum)
-- ===========================================================================
-- Enum, nu text: o valoare inexistentă este eroare de scriere, nu un rând tăcut
-- (tiparul `app_role`). Toate extensibile ÎNAINTE prin `add value`, niciodată rescriere.

-- Faza 1: exact trei stări. Stări intermediare (IP-3) se adaugă additiv dacă se decid.
create type public.issue_status as enum ('received', 'in_progress', 'resolved');

-- Faza 1: O SINGURĂ valoare permisă (OQ-016). `petitie` = valoare + flux în plus ulterior.
create type public.issue_regime as enum ('semnalare');

-- Determinat de ACȚIUNE, nu de UI: depunerea = 'citizen', mutările de workflow = 'official'.
create type public.issue_acting_as as enum ('citizen', 'official');


-- ===========================================================================
-- 2. issue_categories — tabel de suport, per tenant
-- ===========================================================================
-- Tabel, nu enum (ADR-0002): categoriile sunt per-tenant și dezactivabile (o comună fără
-- operator de apă dezactivează `apa`). Setul de coduri rămâne ÎNCHIS în Faza 1 prin `check`.

create table public.issue_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict
             default public.current_tenant_id(),
  code       text not null
             check (code in ('groapa', 'iluminat', 'gunoi', 'caini', 'apa')),
  label      text not null,                       -- etichetă românească cu diacritice
  is_active  boolean not null default true,       -- dezactivabilă per tenant
  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  unique (tenant_id, code),                        -- o categorie o singură dată per tenant
  unique (tenant_id, id)                           -- ținta FK-ului compozit din `issues`
);

create index issue_categories_tenant_active_idx
  on public.issue_categories (tenant_id, is_active);

comment on table public.issue_categories is
  'Categorii de sesizare per tenant. Set de coduri inchis in Faza 1 (FR-003). Seed la onboarding.';


-- ===========================================================================
-- 3. issues — tabelul central
-- ===========================================================================
-- `status` și `assigned_to` sunt PROIECȚII, nu sursă de adevăr: mutarea lor trece EXCLUSIV
-- prin funcțiile din §7. La INSERT, clientul nu le trimite (GRANT pe coloane de intrare).

create table public.issues (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete restrict
                       default public.current_tenant_id(),
  author_user_id       uuid not null references auth.users(id) on delete restrict
                       default auth.uid(),
  regim                public.issue_regime not null default 'semnalare',
  category_id          uuid not null,
  description          text not null check (char_length(description) between 1 and 2000),
  location_lat         double precision not null check (location_lat between -90 and 90),
  location_lng         double precision not null check (location_lng between -180 and 180),
  status               public.issue_status not null default 'received',
  assigned_to          uuid references auth.users(id) on delete restrict,   -- NULL = neatribuit
  client_submission_id uuid not null,                                       -- idempotență (FR-008)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Categoria aparține ACELUIAȘI tenant (previne referirea unei categorii a altui tenant).
  foreign key (tenant_id, category_id)
    references public.issue_categories (tenant_id, id),

  -- O retrimitere a aceleiași încercări nu creează două sesizări (E6/FR-008).
  unique (tenant_id, author_user_id, client_submission_id)
);

-- Indexuri — toate cu `tenant_id` pe prima poziție (C6).
create index issues_tenant_author_created_idx on public.issues (tenant_id, author_user_id, created_at);
create index issues_tenant_status_idx         on public.issues (tenant_id, status);
create index issues_tenant_category_idx       on public.issues (tenant_id, category_id);
create index issues_tenant_assigned_idx       on public.issues (tenant_id, assigned_to);
create index issues_tenant_created_idx        on public.issues (tenant_id, created_at);

comment on table public.issues is
  'Sesizare cetateneasca. status/assigned_to sunt proiectii, mutate DOAR prin functiile de workflow (ADR-0004).';


-- ===========================================================================
-- 4. issue_status_history — append-only, coloana vertebrală
-- ===========================================================================
-- Un rând NOU per tranziție. Creația NU produce rând (AC-010). Sursă de adevăr pentru
-- indicatorii viitori (FUP-9) și audit al schimbării de status (ADR-0003).

create table public.issue_status_history (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  issue_id       uuid not null references public.issues(id) on delete restrict,
  from_status    public.issue_status not null,
  to_status      public.issue_status not null,
  actor_user_id  uuid not null references auth.users(id) on delete restrict,
  actor_role     public.app_role not null,
  acting_as      public.issue_acting_as not null,
  created_at     timestamptz not null default now()
);

create index issue_status_history_tenant_issue_created_idx
  on public.issue_status_history (tenant_id, issue_id, created_at);

comment on table public.issue_status_history is
  'Istoric append-only al tranzitiilor de status. Scriere EXCLUSIV prin change_issue_status (ADR-0004). Nefalsificabil la nivel de privilegiu (C14).';


-- ===========================================================================
-- 5. issue_assignment_history — append-only, simetric
-- ===========================================================================

create table public.issue_assignment_history (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  issue_id           uuid not null references public.issues(id) on delete restrict,
  previous_assignee  uuid references auth.users(id) on delete restrict,   -- NULL = era neatribuită
  new_assignee       uuid references auth.users(id) on delete restrict,   -- NULL = dezatribuită
  actor_user_id      uuid not null references auth.users(id) on delete restrict,
  actor_role         public.app_role not null,
  acting_as          public.issue_acting_as not null,
  created_at         timestamptz not null default now()
);

create index issue_assignment_history_tenant_issue_created_idx
  on public.issue_assignment_history (tenant_id, issue_id, created_at);

comment on table public.issue_assignment_history is
  'Istoric append-only al atribuirilor. Scriere EXCLUSIV prin assign_issue (ADR-0004). Nefalsificabil la nivel de privilegiu (C14).';


-- ===========================================================================
-- 6. Deny by default + privilegii de tabel
-- ===========================================================================
-- ENABLE + FORCE pe toate cele patru tabele: politicile se aplică inclusiv proprietarului
-- (rolul care rulează migrațiile). Fără FORCE, cod care rulează ca owner ocolește tot.
-- (FORCE nu oprește `service_role`/superuser cu BYPASSRLS — INTENȚIONAT, ADR-0002; de aceea
-- funcțiile SECURITY DEFINER de mai jos RECONSTRUIESC frontiera de tenant explicit în corp.)

alter table public.issue_categories         enable row level security;
alter table public.issue_categories         force  row level security;
alter table public.issues                   enable row level security;
alter table public.issues                   force  row level security;
alter table public.issue_status_history     enable row level security;
alter table public.issue_status_history     force  row level security;
alter table public.issue_assignment_history enable row level security;
alter table public.issue_assignment_history force  row level security;

-- `anon` nu primește nimic (citirea publică a categoriilor este amânată la FUP-8, spec §11).
revoke all on public.issue_categories         from anon, authenticated;
revoke all on public.issues                   from anon, authenticated;
revoke all on public.issue_status_history     from anon, authenticated;
revoke all on public.issue_assignment_history from anon, authenticated;

-- issue_categories: doar citire pentru formular. Fără scriere (seed la onboarding, CRUD out of scope).
grant select on public.issue_categories to authenticated;

-- issues: citire (filtrată de RLS) + INSERT DOAR pe coloanele de intrare. `status`, `assigned_to`,
-- `author_user_id`, `tenant_id`, `regim` NU sunt acordate la nivel de coloană: clientul nu le
-- poate scrie, ele vin din default-uri. Fără UPDATE, fără DELETE pentru `authenticated`:
-- mutările trec exclusiv prin funcțiile de workflow (ADR-0004). (Tiparul „coloane sensibile
-- scoase din GRANT" din ADR-0003, extins la INSERT.)
grant select on public.issues to authenticated;
grant insert (category_id, description, location_lat, location_lng, client_submission_id)
  on public.issues to authenticated;

-- Istoricul: DOAR citire. Fără INSERT/UPDATE/DELETE pentru `authenticated` — append-only impus
-- la nivel de privilegiu (C14). Singurul scriitor este funcția SECURITY DEFINER.
grant select on public.issue_status_history     to authenticated;
grant select on public.issue_assignment_history to authenticated;


-- ===========================================================================
-- 7. Politici RLS — frontieră de tenant ȘI de proprietate/rol
-- ===========================================================================
-- Fiecare politică are forma `tenant_id = (select current_tenant_id()) AND <predicat de rol>`.
-- Forma `(select ...)` (InitPlan) se evaluează o dată, nu per rând (spec §19).

------------------------------------------------------------------------------
-- issue_categories — SELECT pe propriul tenant (necesar pentru formular). Fără scriere.
------------------------------------------------------------------------------
create policy issue_categories_select_own_tenant
  on public.issue_categories for select to authenticated
  using ( tenant_id = (select public.current_tenant_id()) );

------------------------------------------------------------------------------
-- issues
------------------------------------------------------------------------------
-- SELECT — cetățeanul: DOAR rândurile lui (confidențialitate între cetățenii aceluiași tenant).
create policy issues_select_own_as_citizen
  on public.issues for select to authenticated
  using (
        tenant_id      = (select public.current_tenant_id())
    and author_user_id = (select auth.uid())
  );

-- SELECT — roluri elevate: toate sesizările tenantului (has_role('leadership') include staff/admin).
create policy issues_select_all_in_tenant_elevated
  on public.issues for select to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and (select public.has_role('leadership'))
  );

-- INSERT — oricine, în tenantul lui, ca autor al lui însuși (cumulativitate: has_role('citizen')).
-- tenant_id/author_user_id vin din default; WITH CHECK îi respinge dacă nu corespund.
create policy issues_insert_own_as_citizen
  on public.issues for insert to authenticated
  with check (
        tenant_id      = (select public.current_tenant_id())
    and author_user_id = (select auth.uid())
    and (select public.has_role('citizen'))
  );

-- Fără politică UPDATE/DELETE pentru `authenticated` pe issues: statusul/atribuirea se schimbă
-- EXCLUSIV prin funcțiile din §7. Editarea de către autor nu e în scop (Î8).

------------------------------------------------------------------------------
-- issue_status_history — DOAR SELECT (append-only; scrierea trece prin funcție)
------------------------------------------------------------------------------
-- Cetățeanul vede istoricul propriilor sesizări (via apartenența issue-ului la el).
create policy issue_status_history_select_own_as_citizen
  on public.issue_status_history for select to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.issues i
       where i.id = issue_id
         and i.author_user_id = (select auth.uid())
    )
  );

-- Rolurile elevate văd tot istoricul tenantului.
create policy issue_status_history_select_elevated
  on public.issue_status_history for select to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and (select public.has_role('leadership'))
  );

------------------------------------------------------------------------------
-- issue_assignment_history — DOAR SELECT, simetric
------------------------------------------------------------------------------
create policy issue_assignment_history_select_own_as_citizen
  on public.issue_assignment_history for select to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.issues i
       where i.id = issue_id
         and i.author_user_id = (select auth.uid())
    )
  );

create policy issue_assignment_history_select_elevated
  on public.issue_assignment_history for select to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and (select public.has_role('leadership'))
  );


-- ===========================================================================
-- 8. change_issue_status — funcție de workflow (SECURITY DEFINER, ADR-0004)
-- ===========================================================================
-- Contractul ADR-0004 §Decizie:
--   - SECURITY DEFINER + `set search_path = ''` + referințe COMPLET calificate. La definer,
--     un search_path needeclarat este o cale de escaladare de privilegii, nu doar un bug.
--   - Tenantul și rolul se RE-DERIVĂ din auth.jwt() (has_role / current_tenant_id / auth.uid),
--     NICIODATĂ din argumente. Semnătura nu conține tenant_id sau role.
--   - Frontiera de tenant e reconstruită EXPLICIT în corp (definer ocolește RLS pe rândul atins).
--   - Refuzurile sunt excepții clasificate prin errcode, nu `200 []`. Mesajul de „not found" nu
--     dezvăluie existența unui rând în alt tenant.
--   - Append istoric + proiecție în ACEEAȘI tranzacție (atomicitate D2).

create or replace function public.change_issue_status(
  p_issue_id        uuid,
  p_expected_status public.issue_status,
  p_to_status       public.issue_status
)
returns public.issue_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.issue_status;
  v_tenant  uuid := public.current_tenant_id();
begin
  -- 1. Autorizare pe rol, re-derivată din JWT. leadership și citizen sunt refuzați.
  if not public.has_role('staff') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- 2. Blocare rând ÎN tenantul apelantului — frontiera de tenant, explicit.
  select i.status into v_current
    from public.issues i
   where i.id = p_issue_id
     and i.tenant_id = v_tenant          -- NU din argument
   for update;
  if not found then
    -- Nu dezvăluie existența unui rând în alt tenant.
    raise exception 'issue not found' using errcode = 'no_data_found';
  end if;

  -- 3. Concurență (E13): statusul real trebuie să fie cel așteptat. Refuz DETERMINIST.
  --    NB: NU folosim errcode '40001' (serialization_failure), deși semantic ar descrie
  --    un conflict: PostgREST reîncearcă automat clasa 40 (serialization/deadlock) până la
  --    timeout (~60s → 504), transformând un refuz instantaneu într-un hang. Un `raise`
  --    simplu (SQLSTATE P0001) întoarce imediat o eroare clasificabilă prin mesaj, distinctă
  --    de not-authorized (42501), not-found (P0002) și invalid-transition (23514).
  if v_current <> p_expected_status then
    raise exception 'stale status' using errcode = 'P0001';
  end if;

  -- 4. Tranziție în setul închis {received->in_progress, in_progress->resolved} (spec §8).
  if not (
       (v_current = 'received'::public.issue_status    and p_to_status = 'in_progress'::public.issue_status)
    or (v_current = 'in_progress'::public.issue_status and p_to_status = 'resolved'::public.issue_status)
  ) then
    raise exception 'invalid transition' using errcode = '23514';
  end if;

  -- 5. Append istoric — from = statusul curent verificat, actor din JWT. acting_as = 'official'.
  insert into public.issue_status_history
    (tenant_id, issue_id, from_status, to_status, actor_user_id, actor_role, acting_as)
  values
    (v_tenant, p_issue_id, v_current, p_to_status,
     (select auth.uid()), public.current_app_role(), 'official'::public.issue_acting_as);

  -- 6. Proiecție — aceeași tranzacție.
  update public.issues
     set status = p_to_status, updated_at = pg_catalog.now()
   where id = p_issue_id;

  return p_to_status;
end;
$$;

comment on function public.change_issue_status(uuid, public.issue_status, public.issue_status) is
  'Muta statusul unei sesizari sub contractul ADR-0004: staff-only, tenant re-derivat din JWT, tranzitie validata, concurenta prin expected_status + FOR UPDATE, append istoric atomic.';

-- PostgreSQL acordă EXECUTE lui PUBLIC implicit — se revocă explicit; doar `authenticated` execută.
revoke execute on function public.change_issue_status(uuid, public.issue_status, public.issue_status) from public, anon;
grant  execute on function public.change_issue_status(uuid, public.issue_status, public.issue_status) to authenticated;


-- ===========================================================================
-- 9. assign_issue — funcție de workflow (SECURITY DEFINER, ADR-0004)
-- ===========================================================================
-- Același tipar: staff-only, FOR UPDATE în tenantul apelantului, verificarea că assignee-ul
-- (dacă nu e NULL) are un rând ACTIV în tenant_users în ACELAȘI tenant, apoi append + proiecție.
-- Atribuirea către un departament rămâne blocată (OQ-011) — Faza 1 atribuie doar unei persoane.

create or replace function public.assign_issue(
  p_issue_id uuid,
  p_assignee uuid   -- nullable: NULL = dezatribuire
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev   uuid;
  v_tenant uuid := public.current_tenant_id();
begin
  -- 1. Autorizare pe rol. leadership și citizen refuzați.
  if not public.has_role('staff') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- 2. Blocare rând în tenantul apelantului.
  select i.assigned_to into v_prev
    from public.issues i
   where i.id = p_issue_id
     and i.tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'issue not found' using errcode = 'no_data_found';
  end if;

  -- 3. Assignee-ul (dacă e dat) trebuie să fie ACTIV în ACELAȘI tenant — previne atribuirea
  --    către un utilizator al altui tenant (spec T60).
  if p_assignee is not null then
    if not exists (
      select 1 from public.tenant_users tu
       where tu.user_id   = p_assignee
         and tu.tenant_id = v_tenant
         and tu.is_active = true
    ) then
      raise exception 'assignee not in tenant' using errcode = '23503';
    end if;
  end if;

  -- 4. Append istoric.
  insert into public.issue_assignment_history
    (tenant_id, issue_id, previous_assignee, new_assignee, actor_user_id, actor_role, acting_as)
  values
    (v_tenant, p_issue_id, v_prev, p_assignee,
     (select auth.uid()), public.current_app_role(), 'official'::public.issue_acting_as);

  -- 5. Proiecție — aceeași tranzacție.
  update public.issues
     set assigned_to = p_assignee, updated_at = pg_catalog.now()
   where id = p_issue_id;
end;
$$;

comment on function public.assign_issue(uuid, uuid) is
  'Atribuie o sesizare unei persoane sub contractul ADR-0004: staff-only, tenant re-derivat din JWT, assignee validat activ in acelasi tenant, append istoric atomic.';

revoke execute on function public.assign_issue(uuid, uuid) from public, anon;
grant  execute on function public.assign_issue(uuid, uuid) to authenticated;
