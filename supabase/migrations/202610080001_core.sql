-- All authorization is evaluated against current records, never JWT role metadata.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 email text not null, display_name text not null check (length(display_name) between 1 and 120),
 role text not null default 'client' check(role in ('admin','client')),
 active boolean not null default true, created_at timestamptz not null default now()
);
create unique index profiles_email_unique on public.profiles(lower(email));
create table public.clients (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 160),
 contact_email text not null default '', description text not null default '' check(length(description)<=10000),
 active boolean not null default true, created_at timestamptz not null default now()
);
create table public.client_memberships (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 user_id uuid not null references public.profiles(id), active boolean not null default true,
 created_at timestamptz not null default now(), unique(client_id,user_id)
);
create index memberships_user on public.client_memberships(user_id,client_id) where active;
create table public.projects (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 name text not null check(length(trim(name)) between 1 and 160), description text not null default '' check(length(description)<=10000),
 application_url text, current_version text check(length(current_version)<=120), support_notes text not null default '' check(length(support_notes)<=10000),
 archived boolean not null default false, created_at timestamptz not null default now(),
 check(application_url is null or application_url ~ '^https?://[^[:space:]]+$'), unique(id,client_id)
);
create index projects_client on public.projects(client_id);
create sequence private.ticket_reference_seq;
create function private.ticket_reference() returns text language sql volatile set search_path='' as $$
 select 'DC-' || lpad(n::text,greatest(6,length(n::text)),'0') from (select nextval('private.ticket_reference_seq') n) s;
$$;
create table public.tickets (
 id uuid primary key default gen_random_uuid(), reference text not null unique default private.ticket_reference(),
 project_id uuid not null, client_id uuid not null references public.clients(id),
 created_by uuid not null references public.profiles(id), author_name text not null,
 request_type text not null check(request_type in ('Bug Report','Complaint','Feature Request','General Question')),
 title text not null check(length(trim(title)) between 3 and 180), description text not null check(length(trim(description)) between 10 and 20000),
 steps_to_reproduce text not null default '' check(length(steps_to_reproduce)<=10000), expected_behavior text not null default '' check(length(expected_behavior)<=10000),
 actual_behavior text not null default '' check(length(actual_behavior)<=10000), affected_version text not null default '' check(length(affected_version)<=120),
 device_browser text not null default '' check(length(device_browser)<=500), requested_urgency text not null default 'Normal' check(requested_urgency in ('Low','Normal','High','Urgent')),
 priority text not null default 'Normal' check(priority in ('Low','Normal','High','Urgent')),
 status text not null default 'Open' check(status in ('Open','In Progress','Waiting for Client','Resolved','Closed')),
 resolution_summary text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(project_id,client_id) references public.projects(id,client_id),
 check(status not in ('Resolved','Closed') or length(trim(resolution_summary))>0)
);
create index tickets_client_date on public.tickets(client_id,created_at desc);
create index tickets_project_status on public.tickets(project_id,status);
create index tickets_status_priority on public.tickets(status,priority,created_at desc);
create index tickets_text on public.tickets using gin(to_tsvector('simple',title || ' ' || description || ' ' || reference));
create table public.ticket_messages (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.tickets(id),
 author_id uuid not null references public.profiles(id), author_name text not null,
 body text not null check(length(trim(body)) between 1 and 20000), created_at timestamptz not null default now(), unique(id,ticket_id)
);
create index messages_ticket on public.ticket_messages(ticket_id,created_at);
create table public.internal_notes (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.tickets(id),
 author_id uuid not null references public.profiles(id), author_name text not null,
 body text not null check(length(trim(body)) between 1 and 20000), created_at timestamptz not null default now()
);
create index notes_ticket on public.internal_notes(ticket_id,created_at);
create table public.attachments (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.tickets(id),
 message_id uuid, created_by uuid not null references public.profiles(id),
 file_name text not null check(length(file_name) between 1 and 200), object_path text not null unique,
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','application/pdf')),
 size_bytes bigint not null check(size_bytes between 1 and 5242880), state text not null default 'pending' check(state in ('pending','ready','deleting')),
 created_at timestamptz not null default now(), foreign key(message_id,ticket_id) references public.ticket_messages(id,ticket_id)
);
create index attachments_ticket on public.attachments(ticket_id,message_id);
create index attachments_pending on public.attachments(created_at) where state='pending';
create table public.ticket_events (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.tickets(id),
 actor_id uuid not null references public.profiles(id), actor_name text not null, kind text not null check(kind in ('created','status_changed','priority_changed','reply_added')),
 detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index events_ticket on public.ticket_events(ticket_id,created_at);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 ticket_id uuid not null references public.tickets(id), title text not null, read_at timestamptz,
 created_at timestamptz not null default now()
);
create index notifications_user on public.notifications(user_id,created_at desc);

create function private.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,display_name) values(new.id,new.email,coalesce(nullif(left(trim(new.raw_user_meta_data->>'display_name'),120),''),split_part(new.email,'@',1)));
 return new;
end; $$;
create trigger devcare_auth_user after insert on auth.users for each row execute function private.on_auth_user();

create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin');
$$;
create function public.is_active_user() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active);
$$;
create function public.can_client(p_client uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or (public.is_active_user() and exists(select 1 from public.client_memberships m join public.clients c on c.id=m.client_id where m.user_id=auth.uid() and m.client_id=p_client and m.active and c.active));
$$;
create function public.can_ticket(p_ticket uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tickets where id=p_ticket and public.can_client(client_id));
$$;
create function private.require_admin() returns void language plpgsql security definer set search_path='' as $$
begin if not public.is_admin() then raise exception 'Active administrator required' using errcode='42501'; end if; end; $$;
create function private.require_ticket(p_ticket uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not public.can_ticket(p_ticket) then raise exception 'Ticket unavailable or access disabled' using errcode='42501'; end if; end; $$;
create function private.event(p_ticket uuid,p_kind text,p_detail jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into public.ticket_events(ticket_id,actor_id,actor_name,kind,detail) select p_ticket,id,display_name,p_kind,p_detail from public.profiles where id=auth.uid();
$$;
create function private.notify(p_ticket uuid,p_title text) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,ticket_id,title)
 select distinct p.id,p_ticket,left(p_title,250) from public.profiles p
 join public.tickets t on t.id=p_ticket
 where p.active and p.id<>auth.uid() and (p.role='admin' or exists(select 1 from public.client_memberships m join public.clients c on c.id=m.client_id where m.user_id=p.id and m.client_id=t.client_id and m.active and c.active));
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_memberships enable row level security;
alter table public.projects enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.internal_notes enable row level security;
alter table public.attachments enable row level security;
alter table public.ticket_events enable row level security;
alter table public.notifications enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy clients_read on public.clients for select to authenticated using(public.can_client(id));
create policy memberships_read on public.client_memberships for select to authenticated using(public.is_admin() or (user_id=auth.uid() and public.can_client(client_id)));
create policy projects_read on public.projects for select to authenticated using(public.can_client(client_id));
create policy tickets_read on public.tickets for select to authenticated using(public.can_client(client_id));
create policy messages_read on public.ticket_messages for select to authenticated using(public.can_ticket(ticket_id));
create policy notes_read on public.internal_notes for select to authenticated using(public.is_admin());
create policy attachments_read on public.attachments for select to authenticated using(public.can_ticket(ticket_id) and (state='ready' or created_by=auth.uid()));
create policy events_read on public.ticket_events for select to authenticated using(public.can_ticket(ticket_id));
create policy notifications_read on public.notifications for select to authenticated using(user_id=auth.uid() and public.can_ticket(ticket_id));
create policy notifications_update on public.notifications for update to authenticated using(user_id=auth.uid() and public.can_ticket(ticket_id)) with check(user_id=auth.uid() and public.can_ticket(ticket_id));
revoke all on all tables in schema public from anon,authenticated;
grant select on public.profiles,public.clients,public.client_memberships,public.projects,public.tickets,public.ticket_messages,public.internal_notes,public.attachments,public.ticket_events,public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;
grant all on all tables in schema public to service_role;
grant usage on schema private to service_role;
grant all on all sequences in schema private to service_role;
revoke all on all functions in schema public from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function public.is_admin(),public.is_active_user(),public.can_client(uuid),public.can_ticket(uuid) to authenticated;
