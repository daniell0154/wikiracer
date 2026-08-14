create extension if not exists pg_cron;

create or replace function public.close_expired_parties()
returns void language plpgsql security definer set search_path = public as $$
begin
  with expired_parties as (
    update public.parties
    set status = 'finished'
    where status = 'finishing'
      and finish_deadline <= now()
    returning id
  )
  update public.party_members
  set status = 'finished',
      placement = 4,
      finished_at = coalesce(finished_at, now())
  where party_id in (select id from expired_parties)
    and status = 'active';
end;
$$;

revoke all on function public.close_expired_parties() from public;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'wikiracer-close-expired-parties';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'wikiracer-close-expired-parties',
    '* * * * *',
    'select public.close_expired_parties();'
  );
end;
$$;
