create function public.save_profile(p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Account disabled' using errcode='42501'; end if;
 update public.profiles set display_name=trim(p_name) where id=auth.uid();
end; $$;
create function public.save_client(p_id uuid,p_name text,p_email text,p_description text,p_active boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 perform private.require_admin();
 if p_id is null then insert into public.clients(name,contact_email,description,active) values(trim(p_name),trim(p_email),p_description,p_active) returning id into v_id;
 else update public.clients set name=trim(p_name),contact_email=trim(p_email),description=p_description,active=p_active where id=p_id returning id into v_id;
 end if;
 if v_id is null then raise exception 'Client not found'; end if;
 return v_id;
end; $$;
create function public.save_project(p_id uuid,p_client uuid,p_name text,p_description text,p_url text,p_version text,p_notes text,p_archived boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_old public.projects;
begin
 perform private.require_admin();
 if p_id is null then
 insert into public.projects(client_id,name,description,application_url,current_version,support_notes,archived) values(p_client,trim(p_name),p_description,nullif(trim(p_url),''),nullif(trim(p_version),''),p_notes,p_archived) returning id into v_id;
 else
 select * into v_old from public.projects where id=p_id for update;
 if v_old.client_id<>p_client then raise exception 'Project client assignment is immutable; create another project'; end if;
 update public.projects set name=trim(p_name),description=p_description,application_url=nullif(trim(p_url),''),current_version=nullif(trim(p_version),''),support_notes=p_notes,archived=p_archived where id=p_id returning id into v_id;
 end if;
 if v_id is null then raise exception 'Project not found'; end if;
 return v_id;
end; $$;
create function public.set_membership(p_client uuid,p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin();
 if not exists(select 1 from public.profiles where id=p_user and role='client') then raise exception 'A client user is required'; end if;
 insert into public.client_memberships(client_id,user_id,active) values(p_client,p_user,p_active) on conflict(client_id,user_id) do update set active=excluded.active;
end; $$;
create function public.set_user_active(p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin();
 if p_user=auth.uid() or exists(select 1 from public.profiles where id=p_user and role='admin') then raise exception 'Use the secure operator procedure for admin access changes'; end if;
 update public.profiles set active=p_active where id=p_user;
 if not found then raise exception 'User not found'; end if;
end; $$;
create function public.create_ticket(p_project uuid,p_type text,p_title text,p_description text,p_steps text default '',p_expected text default '',p_actual text default '',p_version text default '',p_device text default '',p_urgency text default 'Normal') returns public.tickets language plpgsql security definer set search_path='' as $$
declare v_project public.projects; v_ticket public.tickets;
begin
 select * into v_project from public.projects where id=p_project for share;
 if not found or not public.can_client(v_project.client_id) then raise exception 'Project unavailable' using errcode='42501'; end if;
 if v_project.archived then raise exception 'Archived projects cannot receive tickets'; end if;
 if not exists(select 1 from public.clients where id=v_project.client_id and active) then raise exception 'Client account disabled'; end if;
 insert into public.tickets(project_id,client_id,created_by,author_name,request_type,title,description,steps_to_reproduce,expected_behavior,actual_behavior,affected_version,device_browser,requested_urgency)
 select p_project,v_project.client_id,id,display_name,p_type,trim(p_title),trim(p_description),p_steps,p_expected,p_actual,p_version,p_device,p_urgency from public.profiles where id=auth.uid() and active returning * into v_ticket;
 perform private.event(v_ticket.id,'created');
 perform private.notify(v_ticket.id,v_ticket.reference || ' · New ticket: ' || v_ticket.title);
 return v_ticket;
end; $$;
create function public.change_ticket_status(p_ticket uuid,p_status text,p_reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare v_ticket public.tickets; v_admin boolean; v_allowed boolean;
begin
 perform private.require_ticket(p_ticket);
 select * into v_ticket from public.tickets where id=p_ticket for update;
 v_admin:=public.is_admin();
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
 perform private.notify(p_ticket,v_ticket.reference || ' · Status changed to ' || p_status);
end; $$;
create function public.change_ticket_priority(p_ticket uuid,p_priority text) returns void language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
 perform private.require_admin();
 select priority into v_old from public.tickets where id=p_ticket for update;
 if not found then raise exception 'Ticket not found'; end if;
 if v_old=p_priority then return; end if;
 update public.tickets set priority=p_priority,updated_at=now() where id=p_ticket;
 perform private.event(p_ticket,'priority_changed',jsonb_build_object('from',v_old,'to',p_priority));
end; $$;
create function public.send_reply(p_ticket uuid,p_body text) returns public.ticket_messages language plpgsql security definer set search_path='' as $$
declare v_ticket public.tickets; v_message public.ticket_messages;
begin
 perform private.require_ticket(p_ticket);
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status='Closed' then raise exception 'Reopen the ticket before replying'; end if;
 insert into public.ticket_messages(ticket_id,author_id,author_name,body) select p_ticket,id,display_name,trim(p_body) from public.profiles where id=auth.uid() returning * into v_message;
 if v_ticket.status='Waiting for Client' and not public.is_admin() then
 update public.tickets set status='In Progress',updated_at=now() where id=p_ticket;
 perform private.event(p_ticket,'status_changed',jsonb_build_object('from','Waiting for Client','to','In Progress','reason','Client replied'));
 perform private.notify(p_ticket,v_ticket.reference || ' · Status changed to In Progress');
 else update public.tickets set updated_at=now() where id=p_ticket; end if;
 perform private.event(p_ticket,'reply_added',jsonb_build_object('message_id',v_message.id));
 perform private.notify(p_ticket,v_ticket.reference || ' · New reply');
 return v_message;
end; $$;
create function public.add_internal_note(p_ticket uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin();
 insert into public.internal_notes(ticket_id,author_id,author_name,body) select p_ticket,id,display_name,trim(p_body) from public.profiles where id=auth.uid();
 -- Deliberately no public event or notification: internal content stays private.
end; $$;

revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(),public.is_active_user(),public.can_client(uuid),public.can_ticket(uuid),public.save_profile(text),public.save_client(uuid,text,text,text,boolean),public.save_project(uuid,uuid,text,text,text,text,text,boolean),public.set_membership(uuid,uuid,boolean),public.set_user_active(uuid,boolean),public.create_ticket(uuid,text,text,text,text,text,text,text,text,text),public.change_ticket_status(uuid,text,text),public.change_ticket_priority(uuid,text),public.send_reply(uuid,text),public.add_internal_note(uuid,text) to authenticated;
