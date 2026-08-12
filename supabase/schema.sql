create extension if not exists pgcrypto;

create type public.party_status as enum ('lobby', 'voting', 'playing', 'finishing', 'finished');
create type public.member_status as enum ('active', 'finished', 'quit');
create type public.vote_kind as enum ('start', 'target');

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  status public.party_status not null default 'lobby',
  selected_start text,
  selected_target text,
  started_at timestamptz,
  finish_deadline timestamptz,
  created_at timestamptz not null default now()
);

create table public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  status public.member_status not null default 'active',
  clicks integer not null default 0 check (clicks >= 0),
  path jsonb not null default '[]'::jsonb,
  placement smallint check (placement between 1 and 4),
  finished_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create table public.party_options (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  kind public.vote_kind not null,
  title text not null,
  position smallint not null check (position between 1 and 3),
  unique (party_id, kind, position),
  unique (party_id, kind, title)
);

create table public.party_votes (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.vote_kind not null,
  option_id uuid not null references public.party_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (party_id, user_id, kind)
);

alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.party_options enable row level security;
alter table public.party_votes enable row level security;

create or replace function public.is_party_member(p_party_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.party_members where party_id = p_party_id and user_id = auth.uid()
  );
$$;

create policy "members read parties" on public.parties for select using (public.is_party_member(id));
create policy "members read members" on public.party_members for select using (public.is_party_member(party_id));
create policy "members read options" on public.party_options for select using (public.is_party_member(party_id));
create policy "members read votes" on public.party_votes for select using (public.is_party_member(party_id));

create or replace function public.create_party(p_display_name text, p_options jsonb)
returns public.parties language plpgsql security definer set search_path = public as $$
declare
  v_party public.parties;
  v_code text;
  v_item jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if jsonb_array_length(p_options) <> 6 then raise exception 'six options required'; end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.parties where code = v_code);
  end loop;
  insert into public.parties (code, host_id) values (v_code, auth.uid()) returning * into v_party;
  insert into public.party_members (party_id, user_id, display_name) values (v_party.id, auth.uid(), trim(p_display_name));
  for v_item in select * from jsonb_array_elements(p_options) loop
    insert into public.party_options (party_id, kind, title, position)
    values (v_party.id, (v_item->>'kind')::public.vote_kind, v_item->>'title', (v_item->>'position')::smallint);
  end loop;
  update public.parties set status = 'voting' where id = v_party.id returning * into v_party;
  return v_party;
end;
$$;

create or replace function public.join_party(p_code text, p_display_name text)
returns public.parties language plpgsql security definer set search_path = public as $$
declare v_party public.parties; v_count integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_party from public.parties where code = upper(trim(p_code)) for update;
  if not found then raise exception 'party not found'; end if;
  if v_party.status not in ('lobby', 'voting') then raise exception 'party already started'; end if;
  select count(*) into v_count from public.party_members where party_id = v_party.id;
  if v_count >= 10 and not public.is_party_member(v_party.id) then raise exception 'party is full'; end if;
  insert into public.party_members (party_id, user_id, display_name)
  values (v_party.id, auth.uid(), trim(p_display_name))
  on conflict (party_id, user_id) do update set display_name = excluded.display_name;
  return v_party;
end;
$$;

create or replace function public.cast_party_vote(p_party_id uuid, p_kind public.vote_kind, p_option_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_party_member(p_party_id) then raise exception 'not a party member'; end if;
  if not exists (select 1 from public.parties where id = p_party_id and status = 'voting') then raise exception 'voting closed'; end if;
  if not exists (select 1 from public.party_options where id = p_option_id and party_id = p_party_id and kind = p_kind) then raise exception 'invalid option'; end if;
  insert into public.party_votes (party_id, user_id, kind, option_id)
  values (p_party_id, auth.uid(), p_kind, p_option_id)
  on conflict (party_id, user_id, kind) do update set option_id = excluded.option_id, created_at = now();
end;
$$;

create or replace function public.start_party(p_party_id uuid)
returns public.parties language plpgsql security definer set search_path = public as $$
declare v_party public.parties; v_start text; v_target text;
begin
  select * into v_party from public.parties where id = p_party_id for update;
  if not found or v_party.host_id <> auth.uid() then raise exception 'only host can start'; end if;
  if v_party.status <> 'voting' then raise exception 'party cannot start'; end if;
  select o.title into v_start from public.party_options o left join public.party_votes v on v.option_id = o.id
    where o.party_id = p_party_id and o.kind = 'start' group by o.id order by count(v.user_id) desc, o.position asc limit 1;
  select o.title into v_target from public.party_options o left join public.party_votes v on v.option_id = o.id
    where o.party_id = p_party_id and o.kind = 'target' group by o.id order by count(v.user_id) desc, o.position asc limit 1;
  update public.parties set status = 'playing', selected_start = v_start, selected_target = v_target, started_at = now() where id = p_party_id returning * into v_party;
  return v_party;
end;
$$;

create or replace function public.record_party_jump(p_party_id uuid, p_path jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.parties where id = p_party_id and status in ('playing', 'finishing')) then raise exception 'game not active'; end if;
  update public.party_members set clicks = clicks + 1, path = p_path
    where party_id = p_party_id and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'player is not active'; end if;
end;
$$;

create or replace function public.finish_party_member(p_party_id uuid, p_path jsonb)
returns public.party_members language plpgsql security definer set search_path = public as $$
declare v_party public.parties; v_placement smallint; v_member public.party_members;
begin
  select * into v_party from public.parties where id = p_party_id for update;
  if not found or v_party.status not in ('playing', 'finishing') then raise exception 'game not active'; end if;
  if v_party.status = 'finishing' and v_party.finish_deadline <= now() then
    update public.party_members set status = 'finished', placement = 4, finished_at = coalesce(finished_at, now())
      where party_id = p_party_id and status = 'active';
    update public.parties set status = 'finished' where id = p_party_id;
    raise exception 'game ended';
  end if;
  select count(*) + 1 into v_placement from public.party_members where party_id = p_party_id and placement between 1 and 3;
  if v_placement > 3 then v_placement := 4; end if;
  update public.party_members set clicks = clicks + 1, path = p_path, status = 'finished', placement = v_placement, finished_at = now()
    where party_id = p_party_id and user_id = auth.uid() and status = 'active' returning * into v_member;
  if not found then raise exception 'player is not active'; end if;
  if v_placement = 1 then update public.parties set status = 'finishing', finish_deadline = now() + interval '90 seconds' where id = p_party_id; end if;
  return v_member;
end;
$$;

create or replace function public.quit_party_member(p_party_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.party_members set status = 'quit', placement = 4, finished_at = now()
  where party_id = p_party_id and user_id = auth.uid() and status = 'active';
end;
$$;

create or replace function public.close_party(p_party_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.parties where id = p_party_id and status = 'finishing' and finish_deadline <= now()) then return; end if;
  update public.party_members set status = 'finished', placement = 4, finished_at = coalesce(finished_at, now())
    where party_id = p_party_id and status = 'active';
  update public.parties set status = 'finished' where id = p_party_id;
end;
$$;

grant usage on schema public to anon, authenticated;
grant select on public.parties, public.party_members, public.party_options, public.party_votes to anon, authenticated;
revoke all on function public.create_party(text, jsonb), public.join_party(text, text), public.cast_party_vote(uuid, public.vote_kind, uuid), public.start_party(uuid), public.record_party_jump(uuid, jsonb), public.finish_party_member(uuid, jsonb), public.quit_party_member(uuid), public.close_party(uuid) from public;
grant execute on function public.create_party(text, jsonb), public.join_party(text, text), public.cast_party_vote(uuid, public.vote_kind, uuid), public.start_party(uuid), public.record_party_jump(uuid, jsonb), public.finish_party_member(uuid, jsonb), public.quit_party_member(uuid), public.close_party(uuid) to anon, authenticated;

alter publication supabase_realtime add table public.parties, public.party_members, public.party_options, public.party_votes;
