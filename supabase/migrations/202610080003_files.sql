insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ticket-attachments','ticket-attachments',false,5242880,array['image/png','image/jpeg','image/webp','application/pdf']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No authenticated Storage policies. Only the verified Edge Function writes or signs objects.
create function public.reserve_attachment(p_ticket uuid,p_message uuid,p_name text,p_mime text,p_size bigint) returns public.attachments language plpgsql security definer set search_path='' as $$
declare v_ticket public.tickets; v_attachment public.attachments; v_id uuid:=gen_random_uuid();
begin
 perform private.require_ticket(p_ticket);
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status='Closed' then raise exception 'Closed ticket attachments cannot be changed'; end if;
 if p_message is null then
  if v_ticket.created_by<>auth.uid() then raise exception 'Only the ticket author may attach to the original report' using errcode='42501'; end if;
 else
  if not exists(select 1 from public.ticket_messages where id=p_message and ticket_id=p_ticket and author_id=auth.uid()) then raise exception 'Only the reply author may attach files' using errcode='42501'; end if;
 end if;
 if (select count(*) from public.attachments where ticket_id=p_ticket and message_id is not distinct from p_message)>=3 then raise exception 'Maximum three attachments per ticket or reply'; end if;
 insert into public.attachments(id,ticket_id,message_id,created_by,file_name,object_path,mime_type,size_bytes)
 values(v_id,p_ticket,p_message,auth.uid(),p_name,p_ticket::text || '/' || v_id::text,p_mime,p_size) returning * into v_attachment;
 return v_attachment;
end; $$;
create function public.finalize_attachment(p_attachment uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.attachments;
begin
 select * into v from public.attachments where id=p_attachment for update;
 if not found or v.created_by<>auth.uid() then raise exception 'Upload unavailable' using errcode='42501'; end if;
 perform private.require_ticket(v.ticket_id);
 if v.state<>'pending' then raise exception 'Upload is already finalized or scheduled for cleanup'; end if;
 if not exists(select 1 from storage.objects where bucket_id='ticket-attachments' and name=v.object_path and (metadata->>'size')::bigint=v.size_bytes and metadata->>'mimetype'=v.mime_type) then raise exception 'Uploaded object could not be verified'; end if;
 update public.attachments set state='ready' where id=v.id;
end; $$;
revoke all on function public.reserve_attachment(uuid,uuid,text,text,bigint),public.finalize_attachment(uuid) from public,anon,authenticated;
grant execute on function public.reserve_attachment(uuid,uuid,text,text,bigint),public.finalize_attachment(uuid) to authenticated;

-- Lock and claim abandoned rows before touching Storage. A concurrent finalizer
-- either wins the lock and becomes ready, or sees deleting and cannot finalize.
-- Failed Storage removals keep deleting rows so a later sweep can retry safely.
create function public.claim_abandoned_attachments() returns setof public.attachments language sql set search_path='' as $$
 update public.attachments set state='deleting'
 where id in (
  select id from public.attachments
  where state='deleting' or (state='pending' and created_at<now()-interval '24 hours')
  order by created_at limit 100 for update skip locked
 ) returning *;
$$;
revoke all on function public.claim_abandoned_attachments() from public,anon,authenticated;
grant execute on function public.claim_abandoned_attachments() to service_role;
