-- Forward-only cutover. No existing account is granted a scope implicitly.
-- Apply in a maintenance window, then make reviewed operator assignments.
begin;

-- Some installations have an operator-created membership table predating this
-- migration. Accept only the compatible structure and preserve its rows.
create table if not exists public.admin_client_memberships (
  client_id uuid not null references public.clients(id),
  user_id uuid not null references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
do $$
declare v_client smallint; v_user smallint;
begin
  select attnum into v_client from pg_catalog.pg_attribute
    where attrelid = 'public.admin_client_memberships'::regclass and attname = 'client_id' and not attisdropped;
  select attnum into v_user from pg_catalog.pg_attribute
    where attrelid = 'public.admin_client_memberships'::regclass and attname = 'user_id' and not attisdropped;
  if (select count(*) from pg_catalog.pg_attribute
      where attrelid = 'public.admin_client_memberships'::regclass and not attisdropped and attnotnull
        and ((attname in ('client_id','user_id') and atttypid = 'uuid'::regtype)
          or (attname = 'active' and atttypid = 'boolean'::regtype))) <> 3
    or not exists(select 1 from pg_catalog.pg_constraint where conrelid = 'public.admin_client_memberships'::regclass
      and contype = 'p' and conkey = array[v_client,v_user])
    or not exists(select 1 from pg_catalog.pg_constraint where conrelid = 'public.admin_client_memberships'::regclass
      and contype = 'f' and conkey = array[v_client] and confrelid = 'public.clients'::regclass
      and confkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = 'public.clients'::regclass and attname = 'id')])
    or not exists(select 1 from pg_catalog.pg_constraint where conrelid = 'public.admin_client_memberships'::regclass
      and contype = 'f' and conkey = array[v_user] and confrelid = 'public.profiles'::regclass
      and confkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'id')])
    or exists(select 1 from pg_catalog.pg_policy where polrelid = 'public.admin_client_memberships'::regclass) then
    raise exception 'Existing administrator membership structure requires operator review; no records changed';
  end if;
end;
$$;
-- For a pre-existing row, this records when the release adopted the membership;
-- it does not attempt to infer its original creation time.
alter table public.admin_client_memberships add column if not exists created_at timestamptz not null default now();
do $$
begin
  if not exists(select 1 from pg_catalog.pg_attribute where attrelid = 'public.admin_client_memberships'::regclass
    and attname = 'created_at' and not attisdropped and attnotnull and atttypid = 'timestamptz'::regtype) then
    raise exception 'Existing administrator membership timestamp requires operator review; no records changed';
  end if;
end;
$$;
alter table public.admin_client_memberships alter column active set default true;
alter table public.admin_client_memberships alter column created_at set default now();
create index admin_memberships_user on public.admin_client_memberships(user_id, client_id) where active;
create table public.platform_operators (
  user_id uuid primary key references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Keep membership history when a client account is converted; never discard it.
create table private.retired_client_memberships (
  id uuid primary key,
  client_id uuid not null references public.clients(id),
  user_id uuid not null references public.profiles(id),
  active boolean not null,
  created_at timestamptz not null,
  retired_at timestamptz not null default now(),
  retired_by uuid references public.profiles(id)
);
create table private.admin_access_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  client_id uuid references public.clients(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  created_at timestamptz not null default now()
);

create function public.is_platform_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_operators o join public.profiles p on p.id = o.user_id
    where o.user_id = auth.uid() and o.active and p.active and p.role = 'admin'
  );
$$;
create function private.require_operator() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' and not public.is_platform_operator() then
    raise exception 'Trusted operator required' using errcode = '42501';
  end if;
end;
$$;
-- This is a role classification only. It is never a tenant authorization predicate.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;
create or replace function public.can_admin_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_client_memberships m
    join public.profiles p on p.id = m.user_id
    join public.clients c on c.id = m.client_id
    where m.user_id = auth.uid() and m.client_id = p_client
      and m.active and p.active and p.role = 'admin' and c.active
  );
$$;
create function public.can_admin_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.projects where id = p_project and public.can_admin_client(client_id));
$$;
create function public.can_admin_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tickets where id = p_ticket and public.can_admin_client(client_id));
$$;
create or replace function public.can_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_admin_client(p_client) or exists (
    select 1 from public.client_memberships m
    join public.profiles p on p.id = m.user_id
    join public.clients c on c.id = m.client_id
    where m.user_id = auth.uid() and m.client_id = p_client
      and m.active and p.active and p.role = 'client' and c.active
  );
$$;
create or replace function public.can_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tickets where id = p_ticket and public.can_client(client_id));
$$;
create function public.can_read_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid() or public.is_platform_operator() or exists (
    select 1 from public.profiles p join public.client_memberships m on m.user_id = p.id
    where p.id = p_user and p.role = 'client' and public.can_admin_client(m.client_id)
  );
$$;
create function private.require_admin_client(p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_admin_client(p_client) then
    raise exception 'Client unavailable or access disabled' using errcode = '42501';
  end if;
end;
$$;
create or replace function private.require_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A client or ticket scope is required' using errcode = '42501';
end;
$$;
create function private.require_admin_ticket(p_ticket uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_admin_ticket(p_ticket) then
    raise exception 'Ticket unavailable or access disabled' using errcode = '42501';
  end if;
end;
$$;

-- Ordinary administrators cannot claim a user assigned outside their own scope.
-- Unassigned client profiles can be assigned by the invitation completion RPC.
create function private.require_manage_client_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id = p_user and role = 'client')
    or exists(select 1 from public.client_memberships where user_id = p_user
              and not public.can_admin_client(client_id)) then
    raise exception 'User unavailable for this client' using errcode = '42501';
  end if;
end;
$$;

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(public.can_read_profile(id));
drop policy memberships_read on public.client_memberships;
create policy memberships_read on public.client_memberships for select to authenticated
  using(public.can_admin_client(client_id) or (user_id = auth.uid() and public.can_client(client_id))
        or public.is_platform_operator());
drop policy notes_read on public.internal_notes;
create policy notes_read on public.internal_notes for select to authenticated using(public.can_admin_ticket(ticket_id));
-- Operator access is limited to account/user assignment metadata, never ticket content.
drop policy clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using(public.can_client(id) or public.is_platform_operator());
alter table public.admin_client_memberships enable row level security;
alter table public.platform_operators enable row level security;
create policy admin_memberships_read on public.admin_client_memberships for select to authenticated
  using(public.is_platform_operator() or (user_id = auth.uid() and public.can_admin_client(client_id)));
create policy operators_read on public.platform_operators for select to authenticated
  using(public.is_platform_operator());

create or replace function private.notify(p_ticket uuid, p_title text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications(user_id, ticket_id, title)
  select distinct p.id, p_ticket, left(p_title, 250)
  from public.profiles p join public.tickets t on t.id = p_ticket
  join public.clients c on c.id = t.client_id and c.active
  where p.active and p.id <> auth.uid() and (
    (p.role = 'admin' and exists(select 1 from public.admin_client_memberships m
      where m.user_id = p.id and m.client_id = t.client_id and m.active)) or
    (p.role = 'client' and exists(select 1 from public.client_memberships m
      where m.user_id = p.id and m.client_id = t.client_id and m.active))
  );
$$;

create or replace function public.save_client(p_id uuid, p_name text, p_email text, p_description text, p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_id is null then
    if not public.is_platform_operator() and not exists (
      select 1 from public.admin_client_memberships where user_id = auth.uid()
      and public.can_admin_client(client_id)
    ) then raise exception 'Assigned active administrator required' using errcode = '42501'; end if;
    insert into public.clients(name, contact_email, description, active)
    values(trim(p_name), trim(p_email), p_description, p_active) returning id into v_id;
    -- The creator may own a newly created account, never claim an existing account.
    if not public.is_platform_operator() then
      insert into public.admin_client_memberships(client_id, user_id) values(v_id, auth.uid());
    end if;
  else
    if not public.is_platform_operator() then perform private.require_admin_client(p_id); end if;
    update public.clients set name = trim(p_name), contact_email = trim(p_email),
      description = p_description, active = p_active where id = p_id returning id into v_id;
  end if;
  if v_id is null then raise exception 'Client unavailable' using errcode = '42501'; end if;
  return v_id;
end;
$$;
create or replace function public.save_project(p_id uuid, p_client uuid, p_name text, p_description text,
  p_url text, p_version text, p_notes text, p_archived boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_old public.projects;
begin
  perform private.require_admin_client(p_client);
  if p_id is null then
    insert into public.projects(client_id,name,description,application_url,current_version,support_notes,archived)
    values(p_client,trim(p_name),p_description,nullif(trim(p_url),''),nullif(trim(p_version),''),p_notes,p_archived)
    returning id into v_id;
  else
    if not public.can_admin_project(p_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
    select * into v_old from public.projects where id = p_id for update;
    if v_old.client_id <> p_client then raise exception 'Project client assignment is immutable'; end if;
    update public.projects set name=trim(p_name),description=p_description,application_url=nullif(trim(p_url),''),
      current_version=nullif(trim(p_version),''),support_notes=p_notes,archived=p_archived
    where id = p_id returning id into v_id;
  end if;
  if v_id is null then raise exception 'Project unavailable' using errcode = '42501'; end if;
  return v_id;
end;
$$;
create or replace function public.set_membership(p_client uuid, p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize client membership changes with administrator conversion.
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'Client user unavailable' using errcode = '42501'; end if;
  if not public.is_platform_operator() then
    perform private.require_admin_client(p_client);
    if not exists(select 1 from public.profiles where id = p_user and role = 'client') then
      raise exception 'Client user required' using errcode = '42501';
    end if;
    if p_active then
      perform private.require_manage_client_user(p_user);
    elsif not exists(select 1 from public.client_memberships where client_id = p_client and user_id = p_user) then
      -- Do not manufacture a disabled membership to expose a foreign profile.
      raise exception 'Existing client membership required' using errcode = '42501';
    end if;
  elsif not exists(select 1 from public.profiles where id = p_user and role = 'client') then
    raise exception 'Client user required' using errcode = '42501';
  end if;
  insert into public.client_memberships(client_id,user_id,active) values(p_client,p_user,p_active)
    on conflict(client_id,user_id) do update set active=excluded.active;
end;
$$;
create or replace function public.set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- A concurrent conversion must not let an ordinary admin disable a new admin.
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'User unavailable' using errcode = '42501'; end if;
  if not public.is_platform_operator() then
    perform private.require_manage_client_user(p_user);
    if not exists(select 1 from public.client_memberships where user_id = p_user
                  and public.can_admin_client(client_id)) then
      raise exception 'Assigned client user required' using errcode = '42501';
    end if;
  end if;
  if p_user = auth.uid() then raise exception 'Use another trusted operator for your own access changes'; end if;
  update public.profiles set active = p_active where id = p_user;
  if not found then raise exception 'User unavailable' using errcode = '42501'; end if;
end;
$$;
create function public.authorize_client_invitation(p_client uuid, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not public.is_platform_operator() then perform private.require_admin_client(p_client); end if;
  if not exists(select 1 from public.clients where id = p_client and active) then
    raise exception 'Client unavailable' using errcode = '42501';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is not null then
    if not exists(select 1 from public.profiles where id = v_user and role = 'client' and active) then
      raise exception 'User unavailable for this client' using errcode = '42501';
    end if;
    if not public.is_platform_operator() then perform private.require_manage_client_user(v_user); end if;
  end if;
  return v_user;
end;
$$;

-- Conversion/initial assignment is atomic and explicit, and changes no Auth record.
create function public.configure_administrator(p_user uuid, p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  perform private.require_operator();
  select * into v_profile from public.profiles where id = p_user for update;
  if not found or not v_profile.active then raise exception 'Existing active profile required'; end if;
  if not exists(select 1 from public.clients where id = p_client and active) then
    raise exception 'Explicit active client assignment required';
  end if;
  if exists(select 1 from public.platform_operators where user_id = p_user and active) then
    raise exception 'Use a separate account for platform operations';
  end if;
  insert into private.retired_client_memberships(id,client_id,user_id,active,created_at,retired_by)
    select id,client_id,user_id,active,created_at,auth.uid() from public.client_memberships where user_id = p_user;
  -- Narrowly remove only memberships archived immediately above, preserving history.
  delete from public.client_memberships where user_id = p_user;
  update public.profiles set role = 'admin' where id = p_user;
  update public.admin_client_memberships set active = false where user_id = p_user and client_id <> p_client;
  insert into public.admin_client_memberships(client_id,user_id,active) values(p_client,p_user,true)
    on conflict(client_id,user_id) do update set active = true;
  insert into private.admin_access_events(user_id,client_id,actor_id,action)
    values(p_user,p_client,auth.uid(),'configure_administrator');
end;
$$;
create function public.set_admin_membership(p_client uuid, p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_operator();
  perform 1 from public.profiles where id = p_user and role = 'admin' for update;
  if not found then raise exception 'Existing administrator required'; end if;
  if exists(select 1 from public.platform_operators where user_id = p_user and active) then
    raise exception 'Use a separate account for platform operations';
  end if;
  if p_active and (not exists(select 1 from public.clients where id = p_client and active)
                  or not exists(select 1 from public.profiles where id = p_user and active)) then
    raise exception 'Active profile and active client required';
  end if;
  insert into public.admin_client_memberships(client_id,user_id,active) values(p_client,p_user,p_active)
    on conflict(client_id,user_id) do update set active = excluded.active;
  insert into private.admin_access_events(user_id,client_id,actor_id,action)
    values(p_user,p_client,auth.uid(),case when p_active then 'assign_administrator' else 'remove_administrator' end);
end;
$$;
create function public.set_platform_operator(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server operator credentials required' using errcode = '42501'; end if;
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'Existing profile required'; end if;
  if p_active then
    if not exists(select 1 from public.profiles where id = p_user and active) then raise exception 'Existing active profile required'; end if;
    if exists(select 1 from public.admin_client_memberships where user_id = p_user and active)
       or exists(select 1 from public.client_memberships where user_id = p_user and active) then
      raise exception 'Platform operators must use a separate unassigned account';
    end if;
    update public.profiles set role = 'admin' where id = p_user;
  end if;
  insert into public.platform_operators(user_id,active) values(p_user,p_active)
    on conflict(user_id) do update set active = excluded.active;
  insert into private.admin_access_events(user_id,actor_id,action)
    values(p_user,auth.uid(),case when p_active then 'grant_operator' else 'revoke_operator' end);
end;
$$;
create function public.access_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('operator',public.is_platform_operator(), 'scope', md5(
    coalesce((select p.role || ':' || p.active::text from public.profiles p where p.id = auth.uid()), '') || ':' ||
    public.is_platform_operator()::text || ':' || coalesce((
      select string_agg(s.client_id::text || ':' || s.active::text || ':' || c.active::text, ',' order by s.client_id)
      from (
        select client_id,active from public.admin_client_memberships where user_id = auth.uid()
        union all select client_id,active from public.client_memberships where user_id = auth.uid()
      ) s join public.clients c on c.id = s.client_id
    ), '')
  ));
$$;

create or replace function public.change_ticket_status(p_ticket uuid,p_status text,p_reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare v_ticket public.tickets; v_admin boolean; v_allowed boolean;
begin
 perform private.require_ticket(p_ticket);
 select * into v_ticket from public.tickets where id=p_ticket for update;
 v_admin:=public.can_admin_ticket(p_ticket);
 v_allowed:= (v_admin and (
  (v_ticket.status='Open' and p_status in ('In Progress','Waiting for Client','Resolved')) or
  (v_ticket.status='In Progress' and p_status in ('Waiting for Client','Resolved')) or
  (v_ticket.status='Waiting for Client' and p_status in ('In Progress','Resolved')) or
  (v_ticket.status='Closed' and p_status='Open')
 )) or (v_ticket.status='Resolved' and p_status in ('Closed','Open'));
 if v_allowed is not true then raise exception 'This status transition is not permitted' using errcode='42501'; end if;
 if p_status in ('Resolved','Open') and length(trim(p_reason))=0 then raise exception 'A resolution summary or reopen reason is required'; end if;
 if length(p_reason)>10000 then raise exception 'Summary or reason is too long'; end if;
 update public.tickets set status=p_status,updated_at=now(),resolution_summary=case when p_status='Resolved' then trim(p_reason) else resolution_summary end where id=p_ticket;
 perform private.event(p_ticket,'status_changed',jsonb_build_object('from',v_ticket.status,'to',p_status,'reason',trim(p_reason)));
 perform private.notify(p_ticket,v_ticket.reference || ' Â· Status changed to ' || p_status);
end; $$;

create or replace function public.change_ticket_priority(p_ticket uuid,p_priority text) returns void language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
 perform private.require_admin_ticket(p_ticket);
 select priority into v_old from public.tickets where id=p_ticket for update;
 if not found then raise exception 'Ticket not found'; end if;
 if v_old=p_priority then return; end if;
 update public.tickets set priority=p_priority,updated_at=now() where id=p_ticket;
 perform private.event(p_ticket,'priority_changed',jsonb_build_object('from',v_old,'to',p_priority));
end; $$;

create or replace function public.send_reply(p_ticket uuid,p_body text) returns public.ticket_messages language plpgsql security definer set search_path='' as $$
declare v_ticket public.tickets; v_message public.ticket_messages;
begin
 perform private.require_ticket(p_ticket);
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status='Closed' then raise exception 'Reopen the ticket before replying'; end if;
 insert into public.ticket_messages(ticket_id,author_id,author_name,body) select p_ticket,id,display_name,trim(p_body) from public.profiles where id=auth.uid() returning * into v_message;
 if v_ticket.status='Waiting for Client' and not public.can_admin_ticket(p_ticket) then
 update public.tickets set status='In Progress',updated_at=now() where id=p_ticket;
 perform private.event(p_ticket,'status_changed',jsonb_build_object('from','Waiting for Client','to','In Progress','reason','Client replied'));
 perform private.notify(p_ticket,v_ticket.reference || ' Â· Status changed to In Progress');
 else update public.tickets set updated_at=now() where id=p_ticket; end if;
 perform private.event(p_ticket,'reply_added',jsonb_build_object('message_id',v_message.id));
 perform private.notify(p_ticket,v_ticket.reference || ' Â· New reply');
 return v_message;
end; $$;

create or replace function public.add_internal_note(p_ticket uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin_ticket(p_ticket);
 insert into public.internal_notes(ticket_id,author_id,author_name,body) select p_ticket,id,display_name,trim(p_body) from public.profiles where id=auth.uid();
 -- Deliberately no public event or notification: internal content stays private.
end; $$;

create function public.claim_client_attachments(p_client uuid) returns setof public.attachments
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin_client(p_client);
  return query update public.attachments a set state = 'deleting' where a.id in (
    select f.id from public.attachments f join public.tickets t on t.id = f.ticket_id
    where t.client_id = p_client and (f.state = 'deleting' or (f.state = 'pending' and f.created_at < now() - interval '24 hours'))
    order by f.created_at limit 100 for update of f skip locked
  ) returning a.*;
end;
$$;

revoke all on public.admin_client_memberships, public.platform_operators from public, anon, authenticated;
grant select on public.admin_client_memberships, public.platform_operators to authenticated;
grant all on public.admin_client_memberships, public.platform_operators to service_role;
revoke all on private.retired_client_memberships, private.admin_access_events from public, anon, authenticated;
grant all on private.retired_client_memberships, private.admin_access_events to service_role;
revoke all on function private.require_operator(), private.require_admin_client(uuid),
  private.require_admin_ticket(uuid), private.require_manage_client_user(uuid) from public, anon, authenticated;
revoke all on function public.is_platform_operator(), public.can_admin_client(uuid), public.can_admin_project(uuid),
  public.can_admin_ticket(uuid), public.can_read_profile(uuid), public.authorize_client_invitation(uuid,text),
  public.configure_administrator(uuid,uuid), public.set_admin_membership(uuid,uuid,boolean),
  public.set_platform_operator(uuid,boolean), public.access_context(), public.claim_client_attachments(uuid)
  from public, anon, authenticated;
grant execute on function public.is_platform_operator(), public.can_admin_client(uuid), public.can_admin_project(uuid),
  public.can_admin_ticket(uuid), public.can_read_profile(uuid), public.authorize_client_invitation(uuid,text),
  public.configure_administrator(uuid,uuid), public.set_admin_membership(uuid,uuid,boolean),
  public.access_context(), public.claim_client_attachments(uuid) to authenticated;
grant execute on function public.configure_administrator(uuid,uuid), public.set_admin_membership(uuid,uuid,boolean),
  public.set_platform_operator(uuid,boolean) to service_role;

revoke all on function public.is_admin(), public.can_client(uuid), public.can_ticket(uuid),
  public.save_client(uuid,text,text,text,boolean), public.save_project(uuid,uuid,text,text,text,text,text,boolean),
  public.set_membership(uuid,uuid,boolean), public.set_user_active(uuid,boolean),
  public.change_ticket_status(uuid,text,text), public.change_ticket_priority(uuid,text),
  public.send_reply(uuid,text), public.add_internal_note(uuid,text) from public, anon, authenticated;
grant execute on function public.is_admin(), public.can_client(uuid), public.can_ticket(uuid),
  public.save_client(uuid,text,text,text,boolean), public.save_project(uuid,uuid,text,text,text,text,text,boolean),
  public.set_membership(uuid,uuid,boolean), public.set_user_active(uuid,boolean),
  public.change_ticket_status(uuid,text,text), public.change_ticket_priority(uuid,text),
  public.send_reply(uuid,text), public.add_internal_note(uuid,text) to authenticated;

commit;
