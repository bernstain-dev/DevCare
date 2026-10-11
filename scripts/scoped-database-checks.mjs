import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const existingTables = [
  'profiles',
  'clients',
  'client_memberships',
  'projects',
  'tickets',
  'ticket_messages',
  'ticket_events',
  'attachments',
  'internal_notes',
  'notifications',
]
export async function seedBeforeScopedMigration(root) {
  const admin = randomUUID(),
    friend = randomUUID(),
    client = randomUUID(),
    project = randomUUID(),
    ticket = randomUUID(),
    message = randomUUID()
  for (const [id, email] of [
    [admin, 'preexisting-admin@example.test'],
    [friend, 'preexisting-client@example.test'],
  ])
    await root.query('insert into auth.users(id,email) values($1,$2)', [id, email])
  await root.query("update public.profiles set role='admin' where id=$1", [admin])
  await root.query("insert into public.clients(id,name) values($1,'Unassigned legacy business')", [
    client,
  ])
  await root.query('insert into public.client_memberships(client_id,user_id) values($1,$2)', [
    client,
    friend,
  ])
  await root.query(
    "insert into public.projects(id,client_id,name) values($1,$2,'Legacy project')",
    [project, client],
  )
  await root.query(
    "insert into public.tickets(id,project_id,client_id,created_by,author_name,request_type,title,description) values($1,$2,$3,$4,'Legacy client','Bug Report','Legacy issue','Preserved legacy ticket description')",
    [ticket, project, client, friend],
  )
  await root.query(
    "insert into public.ticket_messages(id,ticket_id,author_id,author_name,body) values($1,$2,$3,'Legacy client','Preserved reply')",
    [message, ticket, friend],
  )
  await root.query(
    "insert into public.internal_notes(ticket_id,author_id,author_name,body) values($1,$2,'Legacy admin','Preserved private note')",
    [ticket, admin],
  )
  await root.query(
    "insert into public.ticket_events(ticket_id,actor_id,actor_name,kind) values($1,$2,'Legacy client','created')",
    [ticket, friend],
  )
  await root.query(
    "insert into public.attachments(ticket_id,message_id,created_by,file_name,object_path,mime_type,size_bytes,state) values($1,$2,$3,'legacy.png',$4,'image/png',8,'ready')",
    [ticket, message, friend, `legacy/${randomUUID()}`],
  )
  await root.query(
    "insert into public.notifications(ticket_id,user_id,title) values($1,$2,'Preserved notification')",
    [ticket, admin],
  )
  const rows = {}
  for (const table of existingTables)
    rows[table] = (await root.query(`select * from public.${table} order by id`)).rows
  return { rows, admin, friend, client, ticket }
}
export async function verifyPreservedMigration(root, snapshot, user, ok) {
  for (const table of existingTables) {
    assert.deepEqual(
      (await root.query(`select * from public.${table} order by id`)).rows,
      snapshot.rows[table],
      `${table} preserved by forward migration`,
    )
    ok(true, `${table} rows unchanged`)
  }
  const memberships = await root.query(
    'select client_id,user_id,active from public.admin_client_memberships order by client_id,user_id',
  )
  assert.deepEqual(memberships.rows, snapshot.adminMemberships ?? [], 'No guessed administrator assignments')
  ok(true, 'Existing administrator assignments preserved without inferred grants')
  ok(
    (await root.query("select is_nullable,data_type from information_schema.columns where table_schema='public' and table_name='admin_client_memberships' and column_name='created_at'")).rows
      .some((column) => column.is_nullable === 'NO' && column.data_type === 'timestamp with time zone'),
    'Administrator membership timestamp is present and required',
  )
  await user(snapshot.admin, async (c) =>
    ok(
      (await c.query('select * from public.tickets')).rowCount === 0,
      'Unassigned legacy admin fails closed',
    ),
  )
  await user(snapshot.friend, async (c) =>
    ok(
      (await c.query('select * from public.tickets where id=$1', [snapshot.ticket])).rowCount === 1,
      'Existing client membership still works after migration',
    ),
  )
}

export async function scopedDatabaseChecks({
  root,
  user,
  rpc,
  ok,
  deny,
  adminId: adminA,
  bId: adminB,
  operatorId,
  aId: clientA,
  ca,
  cb,
}) {
  await user(operatorId, (c) => rpc(c, 'set_user_active', [clientA, true]))
  await user(operatorId, (c) => rpc(c, 'set_admin_membership', [cb, adminA, false]))
  const authBefore = (await root.query('select * from auth.users where id=$1', [adminB])).rows[0]
  const oldMemberships = (
    await root.query('select * from public.client_memberships where user_id=$1', [adminB])
  ).rows
  const authCount = (await root.query('select count(*)::int n from auth.users')).rows[0].n
  await user(operatorId, (c) => rpc(c, 'configure_administrator', [adminB, cb]))
  assert.deepEqual(
    (await root.query('select * from auth.users where id=$1', [adminB])).rows[0],
    authBefore,
  )
  ok(
    (await root.query('select count(*)::int n from auth.users')).rows[0].n === authCount,
    'Friend converted without an Auth duplicate',
  )
  ok(
    (await root.query('select * from public.client_memberships where user_id=$1', [adminB]))
      .rowCount === 0,
    'Friend client memberships removed from active table',
  )
  ok(
    (
      await root.query('select * from private.retired_client_memberships where user_id=$1', [
        adminB,
      ])
    ).rowCount === oldMemberships.length,
    'Friend membership history archived',
  )
  ok(
    (await root.query("select * from public.profiles where id=$1 and role='admin'", [adminB]))
      .rowCount === 1,
    'Existing friend profile converted',
  )
  const assignments = (
    await root.query('select * from public.admin_client_memberships where user_id=$1 and active', [
      adminB,
    ])
  ).rows
  ok(
    assignments.length === 1 && assignments[0].client_id === cb,
    'Friend has exactly one active personal business assignment',
  )
  await user(operatorId, (c) => rpc(c, 'configure_administrator', [adminB, cb]))
  ok(
    (
      await root.query(
        'select * from public.admin_client_memberships where user_id=$1 and active',
        [adminB],
      )
    ).rowCount === 1,
    'Conversion retry is idempotent',
  )
  const clientB = randomUUID()
  await root.query("insert into auth.users(id,email) values($1,'scoped-b-client@example.test')", [
    clientB,
  ])
  await user(adminB, (c) => rpc(c, 'set_membership', [cb, clientB, true]))
  const project = async (actor, client, title) =>
    (await user(actor, (c) => rpc(c, 'save_project', [null, client, title, '', '', '', '', false])))
      .save_project
  const pa = await project(adminA, ca, 'Scoped project A'),
    pb = await project(adminB, cb, 'Scoped project B')
  const args = (p) => [
    p,
    'Bug Report',
    'Scoped test issue',
    'Detailed scoped test description',
    '',
    '',
    '',
    '',
    '',
    'Normal',
  ]
  const ta = await user(clientA, (c) => rpc(c, 'create_ticket', args(pa))),
    tb = await user(clientB, (c) => rpc(c, 'create_ticket', args(pb)))
  const ma = await user(adminA, (c) => rpc(c, 'send_reply', [ta.id, 'Admin A reply'])),
    mb = await user(adminB, (c) => rpc(c, 'send_reply', [tb.id, 'Admin B reply']))
  await user(adminA, (c) => rpc(c, 'add_internal_note', [ta.id, 'Admin A private note']))
  await user(adminB, (c) => rpc(c, 'add_internal_note', [tb.id, 'Admin B private note']))
  const attachment = async (actor, ticket, message) => {
    const row = await user(actor, (c) =>
      rpc(c, 'reserve_attachment', [ticket, message, 'scope.png', 'image/png', 8]),
    )
    await root.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', [
      'ticket-attachments',
      row.object_path,
      { size: 8, mimetype: 'image/png' },
    ])
    await user(actor, (c) => rpc(c, 'finalize_attachment', [row.id]))
    return row
  }
  const fa = await attachment(adminA, ta.id, ma.id),
    fb = await attachment(adminB, tb.id, mb.id)
  // Preserve and hide a historical notification generated before its recipient's scope changed.
  await root.query(
    "insert into public.notifications(user_id,ticket_id,title) values($1,$2,'Historical foreign notification')",
    [adminA, tb.id],
  )
  await root.query(
    "insert into public.notifications(user_id,ticket_id,title) values($1,$2,'Historical foreign notification')",
    [adminB, ta.id],
  )
  for (const [
    actor,
    ownClient,
    foreignClient,
    ownProject,
    foreignProject,
    ownTicket,
    foreignTicket,
    foreignFile,
    foreignUser,
    ownClientUser,
    foreignClientUser,
  ] of [
    [adminA, ca, cb, pa, pb, ta.id, tb.id, fb.id, adminB, clientA, clientB],
    [adminB, cb, ca, pb, pa, tb.id, ta.id, fa.id, adminA, clientB, clientA],
  ])
    await user(actor, async (c) => {
      for (const [table, column, id] of [
        ['clients', 'id', foreignClient],
        ['projects', 'id', foreignProject],
        ['tickets', 'id', foreignTicket],
        ['ticket_messages', 'ticket_id', foreignTicket],
        ['ticket_events', 'ticket_id', foreignTicket],
        ['attachments', 'ticket_id', foreignTicket],
        ['internal_notes', 'ticket_id', foreignTicket],
        ['notifications', 'ticket_id', foreignTicket],
        ['client_memberships', 'client_id', foreignClient],
        ['admin_client_memberships', 'client_id', foreignClient],
        ['profiles', 'id', foreignUser],
        ['profiles', 'id', foreignClientUser],
      ])
        ok(
          (await c.query(`select * from public.${table} where ${column}=$1`, [id])).rowCount === 0,
          `Other admin ${table} hidden`,
        )
      for (const [table, column, id] of [
        ['clients', 'id', ownClient],
        ['projects', 'id', ownProject],
        ['tickets', 'id', ownTicket],
        ['internal_notes', 'ticket_id', ownTicket],
        ['notifications', 'ticket_id', ownTicket],
      ])
        ok(
          (await c.query(`select * from public.${table} where ${column}=$1`, [id])).rowCount > 0,
          `Own scoped ${table} visible`,
        )
      for (const [name, values] of [
        ['save_client', [foreignClient, 'Forged change', '', '', true]],
        ['save_project', [null, foreignClient, 'Forged project', '', '', '', '', false]],
        ['save_project', [foreignProject, ownClient, 'Forged project', '', '', '', '', false]],
        ['create_ticket', args(foreignProject)],
        ['change_ticket_status', [foreignTicket, 'Resolved', 'Cross tenant']],
        ['change_ticket_priority', [foreignTicket, 'Urgent']],
        ['send_reply', [foreignTicket, 'Cross tenant']],
        ['add_internal_note', [foreignTicket, 'Cross tenant']],
        ['reserve_attachment', [foreignTicket, null, 'file.png', 'image/png', 8]],
        ['finalize_attachment', [foreignFile]],
        ['claim_client_attachments', [foreignClient]],
        ['claim_abandoned_attachments', []],
        ['set_membership', [foreignClient, ownClientUser, true]],
        ['set_membership', [ownClient, foreignUser, true]],
        ['set_membership', [ownClient, foreignClientUser, true]],
        ['set_membership', [ownClient, foreignClientUser, false]],
        ['set_user_active', [foreignUser, false]],
        ['set_user_active', [foreignClientUser, false]],
        ['authorize_client_invitation', [foreignClient, 'nonexistent@example.test']],
        ['set_admin_membership', [foreignClient, actor, true]],
        ['set_admin_membership', [ownClient, foreignUser, true]],
        ['configure_administrator', [ownClientUser, ownClient]],
        ['set_platform_operator', [actor, true]],
      ])
        await deny(
          () => rpc(c, name, values),
          `Scoped administrator denied ${name} across scope or operator boundary`,
        )
      await deny(
        () =>
          c.query('insert into public.admin_client_memberships(client_id,user_id) values($1,$2)', [
            foreignClient,
            actor,
          ]),
        'Direct admin membership insert denied',
      )
      await deny(
        () =>
          c.query('update public.admin_client_memberships set active=false where user_id=$1', [
            foreignUser,
          ]),
        'Direct admin membership update denied',
      )
      await deny(
        () => c.query("update public.profiles set role='admin' where id=$1", [ownClientUser]),
        'Direct promotion denied',
      )
      ok(
        (
          await c.query('update public.notifications set read_at=now() where ticket_id=$1', [
            foreignTicket,
          ])
        ).rowCount === 0,
        'Foreign notification updates denied',
      )
      ok(
        (
          await c.query('update public.notifications set read_at=now() where ticket_id=$1', [
            ownTicket,
          ])
        ).rowCount > 0,
        'Own notification read state writable',
      )
      await rpc(c, 'save_client', [ownClient, 'Owned business updated', '', '', true])
      await rpc(c, 'save_project', [
        ownProject,
        ownClient,
        'Owned project updated',
        '',
        '',
        '',
        '',
        false,
      ])
      await rpc(c, 'change_ticket_priority', [ownTicket, 'High'])
      await rpc(c, 'change_ticket_status', [ownTicket, 'In Progress', 'Owned status update'])
      ok(true, 'Administrator modifies only its owned business/project/ticket')
    })
  for (const [actor, ticket] of [
    [adminA, tb.id],
    [adminB, ta.id],
  ])
    ok(
      (
        await root.query(
          "select * from public.notifications where user_id=$1 and ticket_id=$2 and title <> 'Historical foreign notification'",
          [actor, ticket],
        )
      ).rowCount === 0,
      'Notification generation never sends to the other admin',
    )
  // Cleanup claims only the selected administrator's abandoned uploads, never
  // ready objects or a foreign account's pending/deleting reservations.
  const pendingA = await user(adminA, (c) =>
    rpc(c, 'reserve_attachment', [ta.id, ma.id, 'pending-a.png', 'image/png', 8]),
  )
  const pendingB = await user(adminB, (c) =>
    rpc(c, 'reserve_attachment', [tb.id, mb.id, 'pending-b.png', 'image/png', 8]),
  )
  await root.query(
    "update public.attachments set created_at=now()-interval '25 hours' where id in ($1,$2)",
    [pendingA.id, pendingB.id],
  )
  await user(adminA, async (c) => {
    const claimed = (await c.query('select * from public.claim_client_attachments($1)', [ca])).rows
    ok(
      claimed.some((row) => row.id === pendingA.id),
      'Own abandoned upload claimed',
    )
    ok(
      claimed.every((row) => row.ticket_id !== tb.id && row.id !== fa.id),
      'Cleanup excludes foreign and finalized attachments',
    )
  })
  ok(
    (await root.query('select state from public.attachments where id=$1', [pendingB.id])).rows[0]
      .state === 'pending',
    'Foreign abandoned upload unchanged',
  )
  // A shared client user cannot be globally disabled or reassigned by one owner.
  await user(operatorId, (c) => rpc(c, 'set_membership', [cb, clientA, true]))
  await user(adminA, (c) =>
    deny(
      () => rpc(c, 'set_user_active', [clientA, false]),
      'Shared client account-wide disable denied',
    ),
  )
  await user(operatorId, (c) => rpc(c, 'set_membership', [cb, clientA, false]))
  // Restore single-client fixture, preserving its shared membership history in the archive.
  await root.query(
    'insert into private.retired_client_memberships(id,client_id,user_id,active,created_at) select id,client_id,user_id,active,created_at from public.client_memberships where user_id=$1 and client_id=$2',
    [clientA, cb],
  )
  await root.query('delete from public.client_memberships where user_id=$1 and client_id=$2', [
    clientA,
    cb,
  ])
  await user(adminA, async (c) => {
    await user(operatorId, (o) => rpc(o, 'set_admin_membership', [ca, adminA, false]))
    ok(
      (await c.query('select * from public.tickets')).rowCount === 0,
      'Removing admin membership immediately blocks existing session',
    )
    await deny(() => rpc(c, 'send_reply', [ta.id, 'Revoked reply']), 'Revoked admin write denied')
    await deny(
      () => rpc(c, 'save_client', [null, 'Claimed new client', '', '', true]),
      'Revoked admin cannot create clients',
    )
    await user(operatorId, (o) => rpc(o, 'set_admin_membership', [ca, adminA, true]))
    await user(operatorId, (o) => rpc(o, 'set_user_active', [adminA, false]))
    ok(
      (await c.query('select * from public.attachments')).rowCount === 0,
      'Disabled admin profile immediately blocks files',
    )
    await deny(
      () => rpc(c, 'change_ticket_priority', [ta.id, 'Urgent']),
      'Disabled admin priority denied',
    )
    await user(operatorId, (o) => rpc(o, 'set_user_active', [adminA, true]))
    await rpc(c, 'save_client', [ca, 'Disabled owned business', '', '', false])
    ok(
      (await c.query('select * from public.projects')).rowCount === 0,
      'Disabled client immediately blocks admin projects',
    )
    await deny(
      () => rpc(c, 'add_internal_note', [ta.id, 'Disabled client note']),
      'Disabled client note denied',
    )
    await deny(
      () => rpc(c, 'save_client', [ca, 'Self reactivate', '', '', true]),
      'Scoped admin cannot bypass disabled client',
    )
    await user(operatorId, (o) =>
      rpc(o, 'save_client', [ca, 'Restored owned business', '', '', true]),
    )
    ok(
      (await c.query('select * from public.tickets where id=$1', [ta.id])).rowCount === 1,
      'Operator can restore exact assignment without session refresh',
    )
  })
  for (const [actor, own, foreign] of [
    [clientA, ta.id, tb.id],
    [clientB, tb.id, ta.id],
  ])
    await user(actor, async (c) => {
      ok(
        (await c.query('select * from public.tickets where id=$1', [own])).rowCount === 1,
        'Existing client retains own access',
      )
      ok(
        (await c.query('select * from public.tickets where id=$1', [foreign])).rowCount === 0,
        'Client remains isolated',
      )
      ok(
        (await c.query('select * from public.internal_notes')).rowCount === 0,
        'Clients cannot read either admin notes',
      )
    })
  // Hold a conversion's profile change uncommitted while an ordinary account
  // manager starts disabling that user. It must check the new role after the
  // row lock is released, rather than disable a concurrently promoted admin.
  await user(adminA, async (c) => {
    const pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid
    await root.query('begin')
    try {
      await root.query("update public.profiles set role='admin' where id=$1", [clientA])
      const outcome = rpc(c, 'set_user_active', [clientA, false]).then(
        () => 'allowed',
        () => 'denied',
      )
      let blocked = false
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked =
          (await root.query('select pg_blocking_pids($1) pids', [pid])).rows[0].pids.length > 0
        if (blocked) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      ok(blocked, 'User management serializes with concurrent role conversion')
      await root.query('commit')
      ok(
        (await outcome) === 'denied',
        'Ordinary admin cannot disable a concurrently converted admin',
      )
      ok(
        (await root.query('select active from public.profiles where id=$1', [clientA])).rows[0]
          .active,
        'Concurrent conversion preserves active account',
      )
    } finally {
      await root.query('rollback')
      await root.query("update public.profiles set role='client' where id=$1", [clientA])
    }
  })
  await user(operatorId, async (c) => {
    ok(
      (
        await c.query('select * from public.admin_client_memberships where user_id in ($1,$2)', [
          adminA,
          adminB,
        ])
      ).rowCount >= 2,
      'Trusted operator manages both administrators',
    )
    ok(
      (await c.query('select * from public.tickets')).rowCount === 0,
      'Operator assignment metadata does not grant ticket access',
    )
    await user(
      null,
      (service) => rpc(service, 'set_platform_operator', [operatorId, false]),
      'service_role',
    )
    await deny(
      () => rpc(c, 'set_admin_membership', [ca, adminA, true]),
      'Revoked operator cannot manage memberships with existing session',
    )
    await user(
      null,
      (service) => rpc(service, 'set_platform_operator', [operatorId, true]),
      'service_role',
    )
  })
  await root.query('update public.profiles set active=false where id=$1', [operatorId])
  await user(
    null,
    (service) => rpc(service, 'set_platform_operator', [operatorId, false]),
    'service_role',
  )
  ok(
    (
      await root.query('select active from public.platform_operators where user_id=$1', [
        operatorId,
      ])
    ).rows[0].active === false,
    'Server operator can revoke a disabled platform operator',
  )
}
