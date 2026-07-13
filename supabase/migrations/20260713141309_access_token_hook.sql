-- Migrația 002 — Custom Access Token Hook.
--
-- Sursa deciziilor:
--   ADR-0002 — cum este SETAT claim-ul de tenant
--   ADR-0003 — cum este SETAT claim-ul de rol
--
-- Hook-ul este locul unde `tenant_users` (server-side, singura sursă de adevăr)
-- devine claim verificat în JWT. Tot restul sistemului — RLS, politici — citește
-- doar rezultatul de aici.
--
-- NU conține: RLS, politici. Acestea vin în migrația următoare.


-- ---------------------------------------------------------------------------
-- Hook-ul
-- ---------------------------------------------------------------------------
-- Reguli absolute, aplicate mai jos:
--
--   1. Sursa de adevăr este BAZA DE DATE. Niciodată `event -> 'claims'`,
--      niciodată `user_metadata`, niciodată un câmp trimis de client. Un rol
--      trimis de client este ignorat pentru că nu este citit.
--
--   2. Claim-urile se scriu EXCLUSIV în `app_metadata`, care nu este scriptibil
--      de client. `user_metadata` ESTE scriptibil (auth.updateUser): un claim de
--      autorizare acolo ar însemna că fiecare utilizator își alege singur rolul.
--
--   3. Claim-ul de rol se numește `app_role`, NU `role`. Cheia `role` de nivel
--      superior aparține PostgREST/Supabase (`authenticated`/`anon`);
--      suprascrierea ei rupe autentificarea sau escaladează la un rol de bază
--      de date. Nu se atinge.
--
--   4. Fără rând ACTIV în `tenant_users` => AMBELE claim-uri LIPSESC din token.
--      Hook-ul nu inventează un tenant și nu inventează un rol. Consecința:
--      current_tenant_id() = NULL ȘI current_app_role() = NULL => RLS refuză
--      peste tot. Fail closed, prin construcție.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims    jsonb;
  v_tenant_id uuid;
  v_role      public.app_role;
begin
  -- SURSA DE ADEVAR: baza de date.
  -- `is_active = false` => cont dezactivat => niciun claim => niciun acces.
  select tu.tenant_id, tu.role
    into v_tenant_id, v_role
    from public.tenant_users tu
   where tu.user_id = (event ->> 'user_id')::uuid
     and tu.is_active = true;

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  -- Ne asiguram ca `app_metadata` exista ca obiect, fara a-l suprascrie.
  v_claims := jsonb_set(
    v_claims,
    '{app_metadata}',
    coalesce(v_claims -> 'app_metadata', '{}'::jsonb),
    true
  );

  if v_tenant_id is not null and v_role is not null then
    v_claims := jsonb_set(v_claims, '{app_metadata,tenant_id}',
                          to_jsonb(v_tenant_id::text), true);
    v_claims := jsonb_set(v_claims, '{app_metadata,app_role}',
                          to_jsonb(v_role::text), true);
  end if;
  -- Ramura `else` lipseste INTENTIONAT. Fara rand activ nu se scrie nimic:
  -- token-ul iese fara `tenant_id` si fara `app_role`. Nu exista valoare
  -- implicita, nu exista tenant „de rezerva", nu exista rol minim acordat tacit.
  -- Un utilizator fara rand activ este autentificat, dar nu poate citi nimic.

  return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Custom Access Token Hook. Scrie tenant_id si app_role in app_metadata, din tenant_users. Fara rand activ => niciun claim => acces refuzat (ADR-0002, ADR-0003).';


-- ---------------------------------------------------------------------------
-- Cine are voie sa execute hook-ul
-- ---------------------------------------------------------------------------
-- Doar `supabase_auth_admin` (rolul cu care Auth emite token-uri).
-- Explicit REVOCAT pentru `authenticated`, `anon` si `public`: daca un client ar
-- putea apela hook-ul, ar putea observa corespondenta utilizator -> tenant
-- pentru orice `user_id`. Nu este o functie de aplicatie.

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- Hook-ul ruleaza ca `supabase_auth_admin` si trebuie sa poata citi tabelul.
-- Acces minim: doar SELECT, doar pe `tenant_users`. Nimic altceva.
grant usage  on schema public       to supabase_auth_admin;
grant select on public.tenant_users to supabase_auth_admin;
