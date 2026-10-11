import assert from 'node:assert/strict'

// Actual HTTP/Auth/Edge/Storage checks; invoked only by the guarded disposable suite.
export async function scopedIntegrationChecks({
  elevated,
  operator,
  admin,
  a,
  b,
  adminUser,
  bUser,
  ca,
  cb,
  pa,
  pb,
  password,
  makeUser,
  client,
  upload,
  args,
  good,
  denied,
}) {
  good(
    await operator.rpc('save_client', {
      p_id: ca,
      p_name: 'Restored disposable A',
      p_email: '',
      p_description: 'Isolation fixture',
      p_active: true,
    }),
    'Operator restores fixture A',
  )
  good(
    await operator.rpc('set_admin_membership', {
      p_client: cb,
      p_user: adminUser.id,
      p_active: false,
    }),
    'Admin A loses B assignment',
  )
  const before = good(
    await elevated.auth.admin.getUserById(bUser.id),
    'Read friend Auth before conversion',
  ).user
  good(
    await operator.functions.invoke('admin-users', {
      body: { action: 'convert_administrator', user_id: bUser.id, client_id: cb },
    }),
    'Operator converts existing accepted friend via Edge',
  )
  const after = good(
    await elevated.auth.admin.getUserById(bUser.id),
    'Read same friend Auth after conversion',
  ).user
  assert.equal(after.id, before.id)
  assert.equal(after.email_confirmed_at, before.email_confirmed_at)
  assert.equal(after.invited_at, before.invited_at)
  assert.deepEqual(after.identities, before.identities)
  assert.equal(
    good(
      await elevated.from('profiles').select('id').eq('email', bUser.email),
      'Exactly one friend profile',
    ).length,
    1,
  )
  assert.equal(
    good(
      await elevated.from('client_memberships').select('*').eq('user_id', bUser.id),
      'Friend client memberships removed',
    ).length,
    0,
  )
  const member = good(
    await elevated
      .from('admin_client_memberships')
      .select('*')
      .eq('user_id', bUser.id)
      .eq('active', true),
    'Friend admin assignment',
  )
  assert.equal(member.length, 1)
  assert.equal(member[0].client_id, cb)
  // The old client JWT must gain only the reviewed B scope, without token refresh.
  assert.equal(
    good(await b.rpc('can_admin_client', { p_client: cb }), 'Existing friend JWT has B scope'),
    true,
  )
  assert.equal(
    good(await b.rpc('can_admin_client', { p_client: ca }), 'Existing friend JWT lacks A scope'),
    false,
  )
  good(await b.auth.signOut(), 'Friend logout')
  good(
    await b.auth.signInWithPassword({ email: bUser.email, password }),
    'Friend original password still works',
  )
  const clientBUser = await makeUser('scoped-b-client'),
    clientB = client()
  good(
    await b.rpc('set_membership', { p_client: cb, p_user: clientBUser.id, p_active: true }),
    'B assigns an ordinary client',
  )
  good(
    await clientB.auth.signInWithPassword({ email: clientBUser.email, password }),
    'B client login',
  )
  const ta = good(await admin.rpc('create_ticket', args(pa)), 'Admin A creates own ticket')
  const tb = good(await b.rpc('create_ticket', args(pb)), 'Admin B creates own ticket')
  const fa = good(await upload(admin, ta.id), 'Admin A uploads own attachment')
  const fb = good(await upload(b, tb.id), 'Admin B uploads own attachment')
  good(
    await a.rpc('send_reply', { p_ticket: ta.id, p_body: 'Client A scoped reply' }),
    'A client reply generates A notification',
  )
  good(
    await clientB.rpc('send_reply', { p_ticket: tb.id, p_body: 'Client B scoped reply' }),
    'B client reply generates B notification',
  )
  good(
    await admin.rpc('add_internal_note', { p_ticket: ta.id, p_body: 'A private note' }),
    'Admin A private note',
  )
  good(
    await b.rpc('add_internal_note', { p_ticket: tb.id, p_body: 'B private note' }),
    'Admin B private note',
  )
  for (const [
    connection,
    ownClient,
    foreignClient,
    ownTicket,
    foreignTicket,
    foreignProject,
    foreignFile,
    foreignUser,
  ] of [
    [admin, ca, cb, ta.id, tb.id, pb, fb.id, bUser],
    [b, cb, ca, tb.id, ta.id, pa, fa.id, adminUser],
  ]) {
    for (const [table, column, value] of [
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
      ['profiles', 'id', foreignUser.id],
    ])
      assert.equal(
        good(
          await connection.from(table).select('*').eq(column, value),
          `Cross-admin ${table} API read`,
        ).length,
        0,
      )
    for (const [name, values] of [
      [
        'change_ticket_status',
        { p_ticket: foreignTicket, p_status: 'Resolved', p_reason: 'Forged scope' },
      ],
      ['change_ticket_priority', { p_ticket: foreignTicket, p_priority: 'Urgent' }],
      ['send_reply', { p_ticket: foreignTicket, p_body: 'Forged scope' }],
      ['add_internal_note', { p_ticket: foreignTicket, p_body: 'Forged scope' }],
      ['set_admin_membership', { p_client: foreignClient, p_user: foreignUser.id, p_active: true }],
      ['set_user_active', { p_user: foreignUser.id, p_active: false }],
    ])
      denied(await connection.rpc(name, values), `Cross-admin ${name} denied`)
    denied(await upload(connection, foreignTicket), 'Cross-admin Edge upload denied')
    denied(
      await connection.functions.invoke('files', {
        body: { action: 'download', attachment_id: foreignFile },
      }),
      'Cross-admin Edge download denied',
    )
    denied(
      await connection.functions.invoke('files', {
        body: { action: 'cleanup', client_id: foreignClient },
      }),
      'Cross-admin Edge cleanup denied',
    )
    denied(
      await connection.functions.invoke('admin-users', {
        body: {
          action: 'invite_administrator',
          client_id: ownClient,
          email: foreignUser.email,
          name: 'Forged promotion',
        },
      }),
      'Ordinary admin cannot invite/promote administrators',
    )
    denied(
      await connection.functions.invoke('admin-users', {
        body: { action: 'convert_administrator', client_id: ownClient, user_id: foreignUser.id },
      }),
      'Ordinary admin cannot convert another admin',
    )
    good(
      await connection.rpc('change_ticket_priority', { p_ticket: ownTicket, p_priority: 'High' }),
      'Own scoped priority update',
    )
  }
  good(
    await operator.rpc('set_admin_membership', {
      p_client: ca,
      p_user: adminUser.id,
      p_active: false,
    }),
    'Operator removes A assignment',
  )
  assert.equal(
    good(await admin.from('tickets').select('*'), 'Revoked admin existing JWT read').length,
    0,
  )
  denied(
    await admin.functions.invoke('files', { body: { action: 'download', attachment_id: fa.id } }),
    'Revoked admin existing JWT download denied',
  )
  good(
    await operator.rpc('set_admin_membership', {
      p_client: ca,
      p_user: adminUser.id,
      p_active: true,
    }),
    'Operator restores A assignment',
  )
  good(
    await operator.rpc('set_user_active', { p_user: bUser.id, p_active: false }),
    'Operator disables B admin',
  )
  assert.equal(
    good(await b.from('tickets').select('*'), 'Disabled B admin existing JWT read').length,
    0,
  )
  denied(
    await b.functions.invoke('files', { body: { action: 'download', attachment_id: fb.id } }),
    'Disabled admin existing JWT download denied',
  )
  good(
    await operator.rpc('set_user_active', { p_user: bUser.id, p_active: true }),
    'Operator restores B admin',
  )
  good(
    await admin.rpc('save_client', {
      p_id: ca,
      p_name: 'Disabled disposable A',
      p_email: '',
      p_description: '',
      p_active: false,
    }),
    'Disable A business',
  )
  assert.equal(
    good(await admin.from('projects').select('*'), 'Disabled business admin existing JWT read')
      .length,
    0,
  )
  denied(
    await admin.functions.invoke('files', { body: { action: 'download', attachment_id: fa.id } }),
    'Disabled business admin download denied',
  )
  good(
    await operator.rpc('save_client', {
      p_id: ca,
      p_name: 'Restored disposable A',
      p_email: '',
      p_description: '',
      p_active: true,
    }),
    'Operator restores A business',
  )
  assert.equal(
    good(await a.from('tickets').select('*').eq('id', tb.id), 'A client remains isolated').length,
    0,
  )
  assert.equal(
    good(await clientB.from('tickets').select('*').eq('id', ta.id), 'B client remains isolated')
      .length,
    0,
  )
}
