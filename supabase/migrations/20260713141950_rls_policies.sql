-- Migratia 003 — RLS si politici.
--
-- Sursa deciziilor:
--   ADR-0002 — izolarea de tenant ca frontiera de securitate, deny by default
--   ADR-0003 — predicatul de rol, cele trei paze anti-escaladare
--
-- Aceasta este migratia in care o greseala NU este un bug, ci o bresa
-- cross-tenant. Fiecare predicat de mai jos opreste un atac diferit.
--
-- Regula care le tine pe toate: predicatul de ROL se adauga cu AND la
-- predicatul de TENANT. Nu il inlocuieste NICIODATA. O politica de rol fara
-- predicat de tenant este o bresa cross-tenant, oricat de corect ar fi
-- predicatul de rol.


-- ===========================================================================
-- 1. Deny by default
-- ===========================================================================
-- ENABLE: politicile se aplica.
-- FORCE : se aplica SI proprietarului tabelului (rolul care ruleaza migratiile).
--         Fara FORCE, cod care ruleaza ca owner ocoleste tacit tot ce urmeaza.
--
-- FORCE nu opreste `service_role` (are BYPASSRLS). Este INTENTIONAT: este calea
-- de acces de urgenta din ADR-0002, decizia 12. De aceea cheia service_role nu
-- are voie sa existe intr-un bundle de client (V2 din ADR-0001).
--
-- Din acest moment, un tabel fara politica este INACCESIBIL, nu deschis.

alter table public.tenants      enable row level security;
alter table public.tenants      force  row level security;

alter table public.tenant_users enable row level security;
alter table public.tenant_users force  row level security;


-- ===========================================================================
-- 2. Privilegii de tabel — primul strat, sub RLS
-- ===========================================================================
-- RLS filtreaza RANDURI. GRANT decide daca operatia e permisa deloc.
-- Doua straturi independente: DELETE nu este acordat NIMANUI pe tenant_users,
-- deci este refuzat si daca cineva ar adauga din greseala o politica DELETE.
--
-- `anon` nu primeste nimic: nu exista inca niciun continut public. Exceptia de
-- citire publica (ADR-0002) vine cu tabelul de anunturi, nu aici.

revoke all on public.tenants      from anon, authenticated;
revoke all on public.tenant_users from anon, authenticated;

grant select, update         on public.tenants      to authenticated;
grant select, insert, update on public.tenant_users to authenticated;
-- Fara DELETE, nicaieri. Dezactivarea se face prin is_active = false.


-- ===========================================================================
-- 3. Hook-ul trebuie sa poata citi tenant_users — ALTFEL NIMENI NU PRIMESTE CLAIM-URI
-- ===========================================================================
-- `supabase_auth_admin` NU are BYPASSRLS. Cu RLS activ si FORCE pe tenant_users,
-- SELECT-ul din custom_access_token_hook este filtrat de politici — iar hook-ul
-- ruleaza fara `auth.uid()` si fara claim-uri, deci nicio politica de mai jos nu
-- l-ar potrivi.
--
-- Consecinta daca lipseste aceasta politica: hook-ul citeste 0 randuri, niciun
-- token nu primeste tenant_id sau app_role, si INTREAGA aplicatie esueaza inchis.
-- Nu s-ar manifesta ca eroare, ci ca "nimeni nu vede nimic" — greu de diagnosticat.
--
-- Politica este limitata strict la rolul Auth. Nu deschide nimic pentru clienti.

create policy tenant_users_select_auth_admin
  on public.tenant_users for select to supabase_auth_admin
  using ( true );


-- ===========================================================================
-- 4. tenants
-- ===========================================================================
-- Citire: doar propriul tenant. Un utilizator al lui A nu vede randul lui B —
-- nici macar numele. Nu exista lista de primarii pentru un utilizator autentificat.

create policy tenants_select_own
  on public.tenants for select to authenticated
  using ( id = (select public.current_tenant_id()) );

-- Modificare (branding, contact): doar tenant_admin, doar propriul tenant.
-- WITH CHECK impiedica un tenant_admin al lui A sa scrie in randul lui B:
-- fara el, USING ar filtra randul vizat, dar nu si randul REZULTAT.
create policy tenants_update_by_tenant_admin
  on public.tenants for update to authenticated
  using (
        id = (select public.current_tenant_id())
    and (select public.has_role('tenant_admin'))
  )
  with check (
        id = (select public.current_tenant_id())
    and (select public.has_role('tenant_admin'))
  );

-- Nicio politica INSERT sau DELETE pe tenants.
-- Crearea unei primarii este procedura operationala de onboarding (ADR-0003),
-- nu functionalitate in aplicatie. Stergerea este deliberata, nu accidentala.


-- ===========================================================================
-- 5. tenant_users — aici se decide daca modelul rezista
-- ===========================================================================
-- Acesta este tabelul care PRODUCE claim-urile. Cine il poate scrie, isi poate
-- scrie rolul. Fiecare predicat de mai jos opreste un atac diferit:
--
--   tenant_id = current_tenant_id()  in USING       -> admin al lui A CITESTE utilizatorii lui B
--   tenant_id = current_tenant_id()  in WITH CHECK  -> admin al lui A ACORDA un rol in B,
--                                                      sau MUTA un utilizator in B.
--                                                      ACESTA este atacul de escaladare
--                                                      cross-tenant. Fara WITH CHECK, reuseste.
--   has_role('tenant_admin')                        -> un citizen/staff isi acorda singur un rol
--   user_id <> auth.uid()                           -> oricine isi modifica PROPRIUL rol

------------------------------------------------------------------------------
-- SELECT
------------------------------------------------------------------------------

-- Oricine isi vede propriul rand. Predicatul de tenant este prezent si aici:
-- fara claim-uri (cont dezactivat, utilizator fara rand), current_tenant_id()
-- este NULL => NULL = NULL este NULL => fals => niciun rand. Fail closed.
create policy tenant_users_select_self
  on public.tenant_users for select to authenticated
  using (
        user_id   = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
  );

-- Un tenant_admin vede utilizatorii tenantului SAU. Rolul se adauga la tenant,
-- nu il inlocuieste: un tenant_admin al lui A nu vede NICIUN utilizator al lui B.
create policy tenant_users_select_tenant_admin
  on public.tenant_users for select to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and (select public.has_role('tenant_admin'))
  );

------------------------------------------------------------------------------
-- INSERT
------------------------------------------------------------------------------

create policy tenant_users_insert_by_tenant_admin
  on public.tenant_users for insert to authenticated
  with check (
        tenant_id = (select public.current_tenant_id())   -- nu poate crea un cont in tenantul B
    and (select public.has_role('tenant_admin'))          -- nu poate crea conturi cine nu e admin
    and user_id <> (select auth.uid())                    -- nu isi poate crea un al doilea rand siesi
  );

------------------------------------------------------------------------------
-- UPDATE — USING **si** WITH CHECK. Ambele. Obligatoriu.
------------------------------------------------------------------------------
-- USING      = ce randuri pot fi ATINSE.
-- WITH CHECK = ce randuri pot REZULTA.
--
-- Fara WITH CHECK, un tenant_admin al lui A ia un rand al lui A si ii seteaza
-- tenant_id = B. Randul dispare din vizorul lui A si apare la B. USING singur
-- NU opreste asta: filtreaza randul de intrare, nu pe cel de iesire.
-- Un UPDATE fara WITH CHECK este un bug de securitate, nu o omisiune stilistica.

create policy tenant_users_update_by_tenant_admin
  on public.tenant_users for update to authenticated
  using (
        tenant_id = (select public.current_tenant_id())
    and (select public.has_role('tenant_admin'))
    and user_id <> (select auth.uid())                    -- nu isi modifica PROPRIUL rol
  )
  with check (
        tenant_id = (select public.current_tenant_id())   -- nu MUTA randul in tenantul B
    and (select public.has_role('tenant_admin'))
    and user_id <> (select auth.uid())
  );

-- Nicio politica DELETE, si niciun GRANT DELETE. Dezactivarea se face prin
-- is_active = false: faptele auditabile nu se sterg (ADR-0002).
--
-- Consecinta acceptata: un citizen NU isi poate modifica propriul rand deloc
-- (nicio politica UPDATE nu il acopera). tenant_users_select_self este DOAR
-- pentru SELECT. Editarea profilului, daca va fi nevoie, primeste o politica
-- proprie, limitata la coloane non-privilegiate — nu se largeste aceasta.
