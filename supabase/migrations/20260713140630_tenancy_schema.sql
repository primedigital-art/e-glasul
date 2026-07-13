-- Migrația 001 — schema de tenancy.
--
-- Sursa deciziilor:
--   ADR-0002 — model de multi-tenancy și rezolvarea tenantului
--   ADR-0003 — model de autentificare și de roluri
--
-- Domeniul acestei migrații: enum-ul de rol, tabelul `tenants`, corespondența
-- utilizator -> tenant, și funcțiile de citire a claim-urilor.
--
-- NU conține: RLS, politici, hook-ul de token, tabele de sesizări/cereri/anunțuri.
-- Acestea vin în migrații ulterioare.
--
-- ATENȚIE: până la activarea RLS (migrația următoare), tabelele de mai jos nu au
-- nicio protecție la nivel de rând. Nu se încarcă date reale înainte de acel pas.


-- ---------------------------------------------------------------------------
-- Rolul: set închis la nivel de tip
-- ---------------------------------------------------------------------------
-- Enum, nu text. Un rol inexistent devine eroare de scriere, nu un rând tăcut
-- pe care nicio politică nu îl potrivește. Exact patru valori (ADR-0003).
-- Nu există `super_admin` și nu se adaugă (ADR-0002, decizia 11).

create type public.app_role as enum ('citizen', 'staff', 'leadership', 'tenant_admin');


-- ---------------------------------------------------------------------------
-- Tenanții
-- ---------------------------------------------------------------------------
-- `slug` și `hostname` determină exclusiv CONTEXTUL DE PREZENTARE.
-- Nu sunt și nu devin niciodată frontieră de securitate (ADR-0002).

create table public.tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,          -- 'botosani' -> botosani.e-glasul.ro
  hostname     text not null unique,          -- 'botosani.e-glasul.ro'
  display_name text not null,                 -- 'Primăria Municipiului Botoșani'
  status       text not null default 'active'
               check (status in ('active', 'suspended')),

  -- Context de PREZENTARE, nu de autorizare:
  branding     jsonb not null default '{}'::jsonb,   -- logo_url, culori
  contact      jsonb not null default '{}'::jsonb,   -- adresă, telefon, email, program

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.tenants is
  'O primarie. slug/hostname = context de prezentare, niciodata frontiera de securitate (ADR-0002).';


-- ---------------------------------------------------------------------------
-- Corespondența utilizator -> tenant + rol
-- ---------------------------------------------------------------------------
-- Cheia primară pe `user_id`: „un cont = un tenant" este o constrângere
-- STRUCTURALĂ, nu o convenție (ADR-0003). Un al doilea rând pentru același
-- utilizator este imposibil, nu doar nedorit.
--
-- Aceasta este SINGURA sursă de adevăr pentru tenant și rol. Hook-ul de token
-- (migrație ulterioară) citește de aici, niciodată din input de client.

create table public.tenant_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  role       public.app_role not null default 'citizen',   -- implicit: cel mai mic privilegiu

  full_name  text,
  is_active  boolean not null default true,   -- dezactivarea nu sterge: faptele auditabile nu se suprascriu

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),  -- cine a acordat contul/rolul este el insusi un fapt auditabil
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index tenant_users_tenant_role_idx on public.tenant_users (tenant_id, role);

comment on table public.tenant_users is
  'Sursa de adevar pentru tenant si rol. PK pe user_id => un cont apartine exact unui tenant (ADR-0003).';


-- ---------------------------------------------------------------------------
-- Citirea claim-urilor din JWT — fail closed prin construcție
-- ---------------------------------------------------------------------------
-- Ambele funcții citesc EXCLUSIV din `app_metadata`, care NU este scriptibil de
-- client. `user_metadata` este scriptibil prin auth.updateUser: un claim de
-- autorizare acolo ar însemna că fiecare utilizator își alege singur tenantul
-- și rolul. Nu se citește niciodată din header, query, body sau hostname.
--
-- Claim absent => NULL. `col = NULL` este NULL, deci fals în USING/WITH CHECK
-- => acces refuzat. Fail closed prin construcție, nu printr-un `if` care poate
-- fi uitat.

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', ''),
    ''
  )::uuid
$$;

comment on function public.current_tenant_id() is
  'Tenantul efectiv, din claim-ul verificat app_metadata.tenant_id. NULL fara claim => acces refuzat.';


-- Claim-ul se numește `app_role`, NU `role`: `claims.role` aparține
-- PostgREST/Supabase (authenticated/anon) și nu are voie suprascris.

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', ''),
    ''
  )::public.app_role
$$;

comment on function public.current_app_role() is
  'Rolul efectiv, din claim-ul verificat app_metadata.app_role. NULL fara claim => acces refuzat.';


-- ---------------------------------------------------------------------------
-- Cumulativitatea rolurilor — modelată într-un SINGUR loc
-- ---------------------------------------------------------------------------
-- Fiecare rol elevat include toate drepturile de cetățean (ADR-0003): într-o
-- comună mică, funcționarul ESTE cetățean. Cumulativitatea trăiește aici, nu
-- împrăștiată prin politici.
--
--   has_role('citizen')      => orice rol
--   has_role('staff')        => staff, tenant_admin        (leadership NU procesează)
--   has_role('leadership')   => leadership, staff, tenant_admin
--   has_role('tenant_admin') => doar tenant_admin

create or replace function public.has_role(required public.app_role)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when public.current_app_role() is null then false   -- claim absent => REFUZ
    when required = 'citizen'      then true            -- orice rol include cetateanul
    when required = 'staff'        then public.current_app_role() in ('staff', 'tenant_admin')
    when required = 'leadership'   then public.current_app_role() in ('leadership', 'staff', 'tenant_admin')
    when required = 'tenant_admin' then public.current_app_role() = 'tenant_admin'
    else false                                          -- necunoscut => REFUZ
  end
$$;

comment on function public.has_role(public.app_role) is
  'Cumulativitatea rolurilor din ADR-0003, intr-un singur loc. Claim absent sau rol necunoscut => false.';
