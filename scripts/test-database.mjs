// Tests real PostgreSQL RLS/RPCs in an isolated temporary cluster. Auth/Storage
// schemas are minimal contracts, NOT a substitute for hosted API integration.
import { Client } from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const bin =
  process.env.POSTGRES_BIN ??
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/18/bin'
    : '/usr/lib/postgresql/17/bin')
const dir = await mkdtemp(join(tmpdir(), 'devcare-pg-'))
const data = join(dir, 'data')
const port = await new Promise((resolve) => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port
    server.close(() => resolve(value))
  })
})
function run(tool, args) {
  const result = spawnSync(join(bin, tool + (process.platform === 'win32' ? '.exe' : '')), args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'ignore',
    timeout: 60000,
  })
  if (result.status !== 0)
    throw new Error(`${tool} failed. Check PostgreSQL binaries and local process permissions.`)
}
let started = false
let root
const config = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }
const adminId = randomUUID(),
  aId = randomUUID(),
  bId = randomUUID(),
  a2Id = randomUUID()
let checks = 0
function ok(value, message) {
  assert.ok(value, message)
  checks++
}
async function user(id, fn, role = 'authenticated') {
  const c = new Client(config)
  await c.connect()
  try {
    await c.query(`set role ${role}`)
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ''])
    return await fn(c)
  } finally {
    await c.end()
  }
}
async function deny(fn, label) {
  await assert.rejects(fn, undefined, label)
  checks++
}
async function rpc(c, name, args = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',')
  return (await c.query(`select * from public.${name}(${placeholders})`, args)).rows[0]
}
try {
  run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'])
  run('pg_ctl', [
    '-D',
    data,
    '-l',
    join(dir, 'postgres.log'),
    '-o',
    `-p ${port} -h 127.0.0.1`,
    '-w',
    'start',
  ])
  started = true
  root = new Client(config)
  await root.connect()
  await root.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;`)
  for (const file of (await readdir('supabase/migrations'))
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await root.query(await readFile(join('supabase/migrations', file), 'utf8'))
  console.log('Applied all migrations to isolated PostgreSQL.')
  for (const [id, email, name, metadata] of [
    [adminId, 'admin@example.test', 'Admin', {}],
    [aId, 'a@example.test', 'Client A', { role: 'admin' }],
    [bId, 'b@example.test', 'Client B', {}],
    [a2Id, 'a2@example.test', 'Client A colleague', {}],
  ])
    await root.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      id,
      email,
      { ...metadata, display_name: name },
    ])
  await root.query("update public.profiles set role='admin' where id=$1", [adminId])
  ok(
    (await root.query('select role from profiles where id=$1', [aId])).rows[0].role === 'client',
    'Metadata cannot grant admin',
  )
  const accountA = await user(adminId, (c) =>
    rpc(c, 'save_client', [null, 'Account A', '', '', true]),
  )
  const accountB = await user(adminId, (c) =>
    rpc(c, 'save_client', [null, 'Account B', '', '', true]),
  )
  const ca = accountA.save_client,
    cb = accountB.save_client
  await user(adminId, async (c) => {
    await rpc(c, 'set_membership', [ca, aId, true])
    await rpc(c, 'set_membership', [ca, a2Id, true])
    await rpc(c, 'set_membership', [cb, bId, true])
  })
  const pa = (
    await user(adminId, (c) =>
      rpc(c, 'save_project', [null, ca, 'Project A', 'A', '', '1.0', 'Support notes', false]),
    )
  ).save_project
  const pb = (
    await user(adminId, (c) =>
      rpc(c, 'save_project', [null, cb, 'Project B', 'B', '', '1.0', '', false]),
    )
  ).save_project
  const ticketArgs = (p, title = 'A meaningful issue') => [
    p,
    'Bug Report',
    title,
    'The application has an issue.',
    '',
    '',
    '',
    '',
    '',
    'Urgent',
  ]
  const ta = await user(aId, (c) => rpc(c, 'create_ticket', ticketArgs(pa)))
  const tb = await user(bId, (c) => rpc(c, 'create_ticket', ticketArgs(pb)))
  ok(
    ta.priority === 'Normal' && ta.requested_urgency === 'Urgent',
    'Client urgency cannot set admin priority',
  )
  ok(/^DC-\d{6,}$/.test(ta.reference), 'Readable references')
  await user(aId, async (c) => {
    ok(
      (await c.query('select * from tickets where id=$1', [tb.id])).rowCount === 0,
      'Other client ticket hidden',
    )
    ok(
      (await c.query('select * from projects where id=$1', [pb])).rowCount === 0,
      'Other client project hidden',
    )
    ok(
      (await c.query('select * from clients where id=$1', [cb])).rowCount === 0,
      'Other client account hidden',
    )
    await deny(
      () => c.query("update profiles set role='admin' where id=$1", [aId]),
      'Self promotion denied',
    )
    await deny(
      () => c.query('insert into client_memberships(client_id,user_id) values($1,$2)', [cb, aId]),
      'Membership invention denied',
    )
    await deny(
      () => c.query('update tickets set client_id=$1,project_id=$2 where id=$3', [cb, pb, ta.id]),
      'Ownership modification denied',
    )
    await deny(
      () =>
        c.query(
          "insert into ticket_events(ticket_id,actor_id,actor_name,kind) values($1,$2,'Fake','created')",
          [ta.id, adminId],
        ),
      'Audit invention denied',
    )
    await deny(
      () =>
        c.query(
          "insert into ticket_messages(ticket_id,author_id,author_name,body) values($1,$2,'Admin','Fake')",
          [ta.id, adminId],
        ),
      'Author impersonation denied',
    )
    await deny(
      () => rpc(c, 'send_reply', [tb.id, 'Cross-account reply']),
      'Cross-account RPC denied',
    )
    await deny(() => rpc(c, 'create_ticket', ticketArgs(pb)), 'Cross-account submission denied')
    await deny(() => rpc(c, 'save_client', [null, 'Fake', '', '', true]), 'Admin RPC denied')
    await deny(() => rpc(c, 'set_user_active', [bId, false]), 'Client cannot disable others')
    await deny(() => rpc(c, 'change_ticket_priority', [ta.id, 'Urgent']), 'Admin priority denied')
    await deny(() => rpc(c, 'add_internal_note', [ta.id, 'Private']), 'Private note RPC denied')
  })
  await user(adminId, (c) => rpc(c, 'add_internal_note', [ta.id, 'Secret admin note']))
  await user(aId, async (c) =>
    ok(
      (await c.query('select * from internal_notes')).rowCount === 0,
      'Internal notes never returned',
    ),
  )
  await user(adminId, async (c) =>
    ok((await c.query('select * from internal_notes')).rowCount === 1, 'Admin reads notes'),
  )
  await user(a2Id, async (c) =>
    ok(
      (await c.query('select * from tickets where id=$1', [ta.id])).rowCount === 1,
      'Colleague shares account tickets',
    ),
  )
  await user(
    null,
    async (c) => {
      await deny(() => c.query('select * from tickets'), 'Anonymous reads denied')
      await deny(() => rpc(c, 'create_ticket', ticketArgs(pa)), 'Anonymous RPC denied')
    },
    'anon',
  )
  // Every combination is checked independently, including unchanged/invalid states.
  const states = ['Open', 'In Progress', 'Waiting for Client', 'Resolved', 'Closed']
  const adminMap = {
    Open: ['In Progress', 'Waiting for Client', 'Resolved'],
    'In Progress': ['Waiting for Client', 'Resolved'],
    'Waiting for Client': ['In Progress', 'Resolved'],
    Resolved: ['Closed', 'Open'],
    Closed: ['Open'],
  }
  for (const actor of [adminId, aId])
    for (const from of states)
      for (const to of states) {
        await root.query('update tickets set status=$1,resolution_summary=$2 where id=$3', [
          from,
          ['Resolved', 'Closed'].includes(from) ? 'Previous resolution' : null,
          ta.id,
        ])
        const allowed =
          actor === adminId
            ? adminMap[from].includes(to)
            : from === 'Resolved' && ['Closed', 'Open'].includes(to)
        if (allowed) {
          await user(actor, (c) =>
            rpc(c, 'change_ticket_status', [ta.id, to, 'Verified summary or reopen reason']),
          )
          checks++
        } else
          await deny(
            () => user(actor, (c) => rpc(c, 'change_ticket_status', [ta.id, to, 'Reason'])),
            'Forbidden transition',
          )
      }
  await root.query("update tickets set status='Open',resolution_summary=null where id=$1", [ta.id])
  await deny(
    () => user(adminId, (c) => rpc(c, 'change_ticket_status', [ta.id, 'Resolved', '   '])),
    'Resolution summary required',
  )
  await user(adminId, (c) =>
    rpc(c, 'change_ticket_status', [ta.id, 'Waiting for Client', 'Please provide details']),
  )
  const reply = await user(aId, (c) =>
    rpc(c, 'send_reply', [ta.id, 'Here are the details you requested.']),
  )
  ok(reply.author_id === aId, 'Message author is trusted caller')
  ok(
    (await root.query('select status from tickets where id=$1', [ta.id])).rows[0].status ===
      'In Progress',
    'Client reply atomically moves status',
  )
  ok(
    (
      await root.query(
        "select * from ticket_events where ticket_id=$1 and detail->>'reason'='Client replied'",
        [ta.id],
      )
    ).rowCount === 1,
    'Automatic transition recorded',
  )
  await user(adminId, (c) =>
    rpc(c, 'change_ticket_status', [ta.id, 'Resolved', 'Fixed the validation error']),
  )
  await deny(
    () => user(aId, (c) => rpc(c, 'change_ticket_status', [ta.id, 'Open', ''])),
    'Reopen reason required',
  )
  await user(aId, (c) => rpc(c, 'change_ticket_status', [ta.id, 'Open', 'The error still occurs']))
  await user(adminId, (c) =>
    rpc(c, 'change_ticket_status', [ta.id, 'Resolved', 'Fixed the remaining cause']),
  )
  await user(aId, (c) => rpc(c, 'change_ticket_status', [ta.id, 'Closed', '']))
  ok(
    (
      await root.query(
        "select * from ticket_events where ticket_id=$1 and detail->>'to'='Resolved'",
        [ta.id],
      )
    ).rowCount >= 2,
    'Resolution history preserved',
  )
  await deny(
    () => user(aId, (c) => rpc(c, 'send_reply', [ta.id, 'Closed reply'])),
    'Closed replies denied',
  )
  await user(adminId, (c) =>
    rpc(c, 'change_ticket_status', [ta.id, 'Open', 'Additional investigation']),
  )
  // 24 independently connected concurrent callers exercise sequence and transactions.
  const concurrent = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      user(aId, (c) => rpc(c, 'create_ticket', ticketArgs(pa, `Concurrent issue ${i}`))),
    ),
  )
  ok(new Set(concurrent.map((t) => t.reference)).size === 24, 'Concurrent references are unique')
  ok(new Set(concurrent.map((t) => t.id)).size === 24, 'UUID primary keys are unique')
  await deny(
    () => user(bId, (c) => rpc(c, 'reserve_attachment', [ta.id, null, 'x.png', 'image/png', 8])),
    'Other client file reservation denied',
  )
  await deny(
    () =>
      user(aId, (c) =>
        rpc(c, 'reserve_attachment', [ta.id, null, 'x.exe', 'application/x-executable', 8]),
      ),
    'MIME boundary denied',
  )
  await deny(
    () =>
      user(aId, (c) =>
        rpc(c, 'reserve_attachment', [ta.id, null, 'x.pdf', 'application/pdf', 5242881]),
      ),
    'Oversize boundary denied',
  )
  const reservations = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) =>
      user(aId, (c) => rpc(c, 'reserve_attachment', [ta.id, null, `x${i}.png`, 'image/png', 8])),
    ),
  )
  ok(
    reservations.filter((x) => x.status === 'fulfilled').length === 3,
    'Concurrent file reservations respect maximum three',
  )
  const file = reservations.find((x) => x.status === 'fulfilled').value
  await deny(
    () => user(aId, (c) => rpc(c, 'finalize_attachment', [file.id])),
    'Absent uploaded object cannot finalize',
  )
  await root.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', [
    'ticket-attachments',
    file.object_path,
    { size: 8, mimetype: 'image/png' },
  ])
  await user(aId, (c) => rpc(c, 'finalize_attachment', [file.id]))
  await root.query(
    "update attachments set created_at=now()-interval '25 hours' where state='pending'",
  )
  await deny(
    () => user(aId, (c) => rpc(c, 'claim_abandoned_attachments')),
    'Client cannot claim cleanup',
  )
  const claimed = await user(
    null,
    async (c) => (await c.query('select * from claim_abandoned_attachments()')).rows,
    'service_role',
  )
  ok(
    claimed.length === 2 && claimed.every((row) => row.state === 'deleting'),
    'Cleanup claims only abandoned pending objects',
  )
  await deny(
    () => user(aId, (c) => rpc(c, 'finalize_attachment', [claimed[0].id])),
    'Claimed cleanup cannot race with finalization',
  )
  ok(
    (await root.query("select * from attachments where id=$1 and state='ready'", [file.id]))
      .rowCount === 1,
    'Cleanup preserves ready files',
  )
  const resumed = await user(
    null,
    async (c) => (await c.query('select * from claim_abandoned_attachments()')).rows,
    'service_role',
  )
  ok(resumed.length === 2, 'Failed cleanup remains retryable')
  await user(bId, async (c) =>
    ok(
      (await c.query('select * from attachments where id=$1', [file.id])).rowCount === 0,
      'Other client attachment metadata hidden',
    ),
  )
  await user(adminId, (c) => rpc(c, 'change_ticket_status', [tb.id, 'In Progress', 'Reviewing']))
  const ownNotification = (
    await root.query('select * from notifications where user_id=$1 limit 1', [bId])
  ).rows[0]
  await user(aId, async (c) => {
    assert.ok(ownNotification, 'Backend generated the notification for Client B')
    ok(
      (await c.query('select * from notifications where id=$1', [ownNotification.id])).rowCount ===
        0,
      'Other user notifications hidden',
    )
    ok(
      (await c.query('update notifications set read_at=now() where id=$1', [ownNotification.id]))
        .rowCount === 0,
      'Other user mark-read denied',
    )
    await deny(
      () => c.query('update notifications set user_id=$1', [aId]),
      'Notification ownership immutable',
    )
  })
  await user(adminId, (c) =>
    rpc(c, 'save_project', [pa, ca, 'Project A', 'A', '', '1.0', '', true]),
  )
  await deny(
    () => user(aId, (c) => rpc(c, 'create_ticket', ticketArgs(pa))),
    'Archived submissions denied',
  )
  await user(aId, async (c) =>
    ok(
      (await c.query('select * from tickets where id=$1', [ta.id])).rowCount === 1,
      'Archived history remains readable',
    ),
  )
  await deny(
    () => user(adminId, (c) => rpc(c, 'save_project', [pa, cb, 'Changed', '', '', '', '', true])),
    'Project client reassignment denied',
  )
  // These checks reuse signed-in identity strings: no token refresh is needed to revoke access.
  await user(adminId, (c) => rpc(c, 'set_membership', [ca, aId, false]))
  await user(aId, async (c) =>
    ok(
      (await c.query('select * from tickets')).rowCount === 0,
      'Disabled membership denies existing identity',
    ),
  )
  await user(adminId, (c) => rpc(c, 'set_membership', [ca, aId, true]))
  await user(adminId, (c) => rpc(c, 'save_client', [ca, 'Account A', '', '', false]))
  await user(aId, async (c) => {
    ok(
      (await c.query('select * from projects')).rowCount === 0,
      'Disabled client account denies projects',
    )
    ok(
      (await c.query('select * from attachments')).rowCount === 0,
      'Disabled client account denies files',
    )
  })
  await user(adminId, (c) => rpc(c, 'save_client', [ca, 'Account A', '', '', true]))
  await user(adminId, (c) => rpc(c, 'set_user_active', [aId, false]))
  await user(aId, async (c) => {
    ok(
      (await c.query('select * from tickets')).rowCount === 0,
      'Disabled user denies existing identity',
    )
    await deny(() => rpc(c, 'send_reply', [ta.id, 'Disabled reply']), 'Disabled writes denied')
    await deny(() => rpc(c, 'finalize_attachment', [file.id]), 'Disabled file access denied')
  })
  ok(
    (
      await root.query(
        "select count(*)::int n from pg_tables where schemaname='public' and rowsecurity",
      )
    ).rows[0].n === 10,
    'All ten application tables enable RLS',
  )
  console.log(
    `PASS: ${checks} PostgreSQL authorization, workflow, concurrency and file-boundary checks.`,
  )
} finally {
  await root?.end()
  if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  // Only the exact OS-generated test directory created above is removed.
  if (dir.startsWith(join(tmpdir(), 'devcare-pg-'))) await rm(dir, { recursive: true, force: true })
}
