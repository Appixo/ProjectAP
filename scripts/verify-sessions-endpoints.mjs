// Smoke test for PATCH /api/sessions/[id] and DELETE /api/sessions/[id].
// Run against a local dev server (session-mode auth, no token needed).
// Creates a test session, exercises every code path, cleans up.

const BASE = process.env.BASE ?? 'http://localhost:3000'

let pass = 0, fail = 0
function expect(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, json, text }
}

function show(label, r) {
  console.log(`  [${r.status}] ${label}: ${r.text.length > 240 ? r.text.slice(0, 240) + '…' : r.text}`)
}

let id

console.log('=== 1. POST create test session with exercises[] ===')
{
  const r = await http('POST', '/api/sessions', [{
    session_at_local: '2026-05-27T17:00',
    modality: 'strength_lower',
    status: 'planned',
    format: 'A: squat · B: RDL · C: split squat',
    description: {
      reason: 'PATCH/DELETE smoke test — safe to delete',
      exercises: [
        { name: 'Back squat',             sets: 4, reps: '5',       weight: '80 kg',     rest_s: 180 },
        { name: 'Romanian deadlift',      sets: 3, reps: '8',       weight: '70 kg',     rest_s: 120 },
        { name: 'Bulgarian split squat',  sets: 3, reps: '10/side', weight: '16 kg DBs', rest_s: 90  },
      ],
    },
  }])
  show('POST', r)
  expect('201 Created', r.status === 201)
  id = r.json?.sessions?.[0]?.id
  expect('returned id', !!id)
  expect('exercises round-trip in POST response',
    Array.isArray(r.json?.sessions?.[0]?.description?.exercises) &&
    r.json.sessions[0].description.exercises.length === 3)
}

console.log(`\n=== 2. PATCH a few fields — must NOT clobber description ===`)
{
  const r = await http('PATCH', `/api/sessions/${id}`, {
    status: 'completed',
    rpe: 7,
    duration_min: 55,
  })
  show('PATCH', r)
  expect('200 OK', r.status === 200)
  expect('status updated to completed', r.json?.session?.status === 'completed')
  expect('rpe updated to 7', r.json?.session?.rpe === 7)
  expect('duration_min updated to 55', r.json?.session?.duration_min === 55)
  expect('description.exercises preserved (omitted from body)',
    Array.isArray(r.json?.session?.description?.exercises) &&
    r.json.session.description.exercises.length === 3)
  expect('description.reason preserved (omitted from body)',
    r.json?.session?.description?.reason?.includes('smoke test'))
  expect('modality untouched', r.json?.session?.modality === 'strength_lower')
  expect('format untouched', r.json?.session?.format?.startsWith('A: squat'))
}

console.log(`\n=== 3. PATCH description — must REPLACE whole (no merge) ===`)
{
  const r = await http('PATCH', `/api/sessions/${id}`, {
    description: {
      exercises: [{ name: 'Front squat', sets: 3, reps: '5', weight: '70 kg' }],
    },
  })
  show('PATCH desc', r)
  expect('200 OK', r.status === 200)
  expect('exercises replaced',
    r.json?.session?.description?.exercises?.length === 1 &&
    r.json.session.description.exercises[0].name === 'Front squat')
  expect('reason wiped (whole-replace semantics)',
    r.json?.session?.description?.reason === undefined)
  expect('rest_s omitted in new prescription is absent',
    r.json?.session?.description?.exercises[0].rest_s === undefined)
}

console.log(`\n=== 4. Export endpoint shows the row + new schema field ===`)
{
  const r = await http('GET', '/api/export')
  expect('200 OK', r.status === 200)
  const row = r.json?.training_sessions?.find(s => s.id === id)
  expect('test row visible in /api/export', !!row)
  expect('exercises[] round-trips through export',
    row?.description?.exercises?.[0]?.name === 'Front squat')
  expect('schema docs exercises field',
    typeof r.json?.context?.schema?.training_sessions?.description?.shape?.exercises === 'string')
  expect('write_endpoints documents PATCH',
    r.json?.context?.write_endpoints?.sessions?.related_endpoints?.patch?.method === 'PATCH')
  expect('write_endpoints documents DELETE',
    r.json?.context?.write_endpoints?.sessions?.related_endpoints?.delete?.method === 'DELETE')
}

console.log(`\n=== 5. PATCH validation — bad description rejected ===`)
{
  const r = await http('PATCH', `/api/sessions/${id}`, {
    description: { exercises: [{ name: 'Bad', sets: 0, reps: '5' }] },  // sets out of range
  })
  show('PATCH bad', r)
  expect('400 invalid_description', r.status === 400 && r.json?.error === 'invalid_description')
}

console.log(`\n=== 6. PATCH empty body — rejected ===`)
{
  const r = await http('PATCH', `/api/sessions/${id}`, {})
  show('PATCH empty', r)
  expect('400 no_fields', r.status === 400 && r.json?.error === 'no_fields')
}

console.log(`\n=== 7. PATCH non-existent id — 404 ===`)
{
  const fake = '00000000-0000-0000-0000-000000000000'
  const r = await http('PATCH', `/api/sessions/${fake}`, { rpe: 5 })
  show('PATCH 404', r)
  expect('404 not_found', r.status === 404 && r.json?.error === 'not_found')
}

console.log(`\n=== 8. DELETE — first call ok ===`)
{
  const r = await http('DELETE', `/api/sessions/${id}`)
  show('DELETE 1', r)
  expect('200 OK', r.status === 200)
  expect('deleted echoes id', r.json?.deleted === id)
}

console.log(`\n=== 9. DELETE again — idempotent-friendly 404 ===`)
{
  const r = await http('DELETE', `/api/sessions/${id}`)
  show('DELETE 2', r)
  expect('404 not_found (not 500)', r.status === 404 && r.json?.error === 'not_found')
}

console.log(`\n=== 10. Verify row is gone from /api/export ===`)
{
  const r = await http('GET', '/api/export')
  const row = r.json?.training_sessions?.find(s => s.id === id)
  expect('test row absent from /api/export', !row)
}

console.log(`\n=== 11. GET /api/sessions/last — modality validation ===`)
{
  const r = await http('GET', '/api/sessions/last')
  expect('400 invalid_modality (missing)', r.status === 400 && r.json?.error === 'invalid_modality')
  const r2 = await http('GET', '/api/sessions/last?modality=not_a_modality')
  expect('400 invalid_modality (bogus)', r2.status === 400 && r2.json?.error === 'invalid_modality')
}

console.log(`\n=== 12. GET /api/sessions/last — round trip with a fresh row ===`)
{
  // Create a unique strength session in the recent past so the lookup is
  // deterministic regardless of what's already in the DB. session_at_local
  // is yesterday at 17:00, status='completed'.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const create = await http('POST', '/api/sessions', [{
    session_at_local: `${yesterday}T17:00`,
    modality: 'strength_upper',
    status: 'completed',
    duration_min: 42,
    format: 'A: press · B: row · C: curl',
    description: {
      exercises: [
        { name: 'Overhead press', sets: 4, reps: '6', weight: '45 kg', rest_s: 150 },
        { name: 'Barbell row',    sets: 4, reps: '8', weight: '60 kg', rest_s: 120 },
        { name: 'Hammer curl',    sets: 3, reps: '10', weight: '14 kg DBs', rest_s: 60 },
      ],
    },
  }])
  expect('POST seed 201', create.status === 201)
  const seedId = create.json?.sessions?.[0]?.id

  const r = await http('GET', '/api/sessions/last?modality=strength_upper')
  expect('200 OK', r.status === 200)
  expect('returns the seeded row',
    r.json?.session?.id === seedId,
    `expected ${seedId}, got ${r.json?.session?.id}`)
  expect('format round-trips', r.json?.session?.format === 'A: press · B: row · C: curl')
  expect('duration_min round-trips', r.json?.session?.duration_min === 42)
  expect('exercises round-trip',
    r.json?.session?.description?.exercises?.length === 3 &&
    r.json.session.description.exercises[0].name === 'Overhead press')

  // Cleanup
  const del = await http('DELETE', `/api/sessions/${seedId}`)
  expect('cleanup DELETE ok', del.status === 200)
}

console.log(`\n=== 13. GET /api/sessions/last — 404 when no prior row exists ===`)
{
  // 'rest' is rarely written in this app (rest days are typically just empty
  // slots). If the DB happens to have one, this check will spuriously pass
  // as 200 — skip non-strictly in that case.
  const r = await http('GET', '/api/sessions/last?modality=rest')
  if (r.status === 200) {
    console.log(`  ~ skip: 'rest' modality has prior rows in DB, can't assert 404`)
  } else {
    expect('404 not_found', r.status === 404 && r.json?.error === 'not_found')
  }
}

console.log(`\n──────────────────────────────────`)
console.log(`PASS ${pass}  FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
