-- Keep the deployed RPC signatures in sync with the browser client and make
-- round completion atomic. This migration is safe to apply more than once.

drop function if exists public.record_party_jump(uuid, jsonb);
drop function if exists public.finish_party_member(uuid, jsonb);

create or replace function public.record_party_jump(p_party_id uuid, p_path jsonb, p_clicks integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.parties where id = p_party_id and status in ('playing', 'finishing')) then
    raise exception 'game not active';
  end if;
  if p_clicks < 0 then raise exception 'invalid click count'; end if;
  update public.party_members
    set clicks = greatest(clicks, p_clicks), path = p_path
    where party_id = p_party_id and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'player is not active'; end if;
end;
$$;

create or replace function public.finish_party_member(p_party_id uuid, p_path jsonb, p_clicks integer)
returns public.party_members language plpgsql security definer set search_path = public as $$
declare
  v_party public.parties;
  v_placement smallint;
  v_member public.party_members;
begin
  select * into v_party from public.parties where id = p_party_id for update;
  if not found or v_party.status not in ('playing', 'finishing') then raise exception 'game not active'; end if;

  if v_party.status = 'finishing' and v_party.finish_deadline <= now() then
    update public.party_members
      set status = 'finished', placement = coalesce(placement, 4), finished_at = coalesce(finished_at, now())
      where party_id = p_party_id and status = 'active';
    update public.parties set status = 'finished' where id = p_party_id;
    select * into v_member from public.party_members where party_id = p_party_id and user_id = auth.uid();
    return v_member;
  end if;

  select count(*) + 1 into v_placement
    from public.party_members where party_id = p_party_id and placement between 1 and 3;
  if v_placement > 3 then v_placement := 4; end if;
  if p_clicks < 0 then raise exception 'invalid click count'; end if;

  update public.party_members
    set clicks = greatest(clicks, p_clicks), path = p_path, status = 'finished', placement = v_placement, finished_at = now()
    where party_id = p_party_id and user_id = auth.uid() and status = 'active'
    returning * into v_member;
  if not found then raise exception 'player is not active'; end if;

  if not exists (select 1 from public.party_members where party_id = p_party_id and status = 'active') then
    update public.parties set status = 'finished', finish_deadline = coalesce(finish_deadline, now()) where id = p_party_id;
  elsif v_placement = 1 then
    update public.parties set status = 'finishing', finish_deadline = now() + interval '90 seconds' where id = p_party_id;
  end if;
  return v_member;
end;
$$;

create or replace function public.close_party(p_party_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_party_member(p_party_id) then raise exception 'not a party member'; end if;
  if not exists (
    select 1 from public.parties
    where id = p_party_id and status = 'finishing' and finish_deadline <= now()
    for update
  ) then return; end if;
  update public.party_members
    set status = 'finished', placement = coalesce(placement, 4), finished_at = coalesce(finished_at, now())
    where party_id = p_party_id and status = 'active';
  update public.parties set status = 'finished' where id = p_party_id;
end;
$$;

create or replace function public.return_party_to_lobby(p_party_id uuid)
returns public.parties language plpgsql security definer set search_path = public as $$
declare v_party public.parties;
begin
  select * into v_party from public.parties where id = p_party_id for update;
  if not found or v_party.host_id <> auth.uid() then raise exception 'only host can return to lobby'; end if;
  if v_party.status <> 'finished' then raise exception 'party is not finished'; end if;
  delete from public.party_votes where party_id = p_party_id;
  delete from public.party_options where party_id = p_party_id;
  update public.party_members
    set status = 'active', clicks = 0, path = '[]'::jsonb, placement = null, finished_at = null
    where party_id = p_party_id;
  update public.parties
    set status = 'lobby', selected_start = null, selected_target = null, started_at = null, finish_deadline = null
    where id = p_party_id returning * into v_party;
  return v_party;
end;
$$;

revoke all on function public.record_party_jump(uuid, jsonb, integer), public.finish_party_member(uuid, jsonb, integer), public.close_party(uuid), public.return_party_to_lobby(uuid) from public;
grant execute on function public.record_party_jump(uuid, jsonb, integer), public.finish_party_member(uuid, jsonb, integer), public.close_party(uuid), public.return_party_to_lobby(uuid) to anon, authenticated;
