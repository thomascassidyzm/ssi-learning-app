#!/usr/bin/env node
// Seconds since Tom's last zho_for_eng player_event. Prints one integer.
const path = require('path')
const DASH = '/home/tomcassidy/ssi-dashboard-v7-clean'
require(path.join(DASH, 'node_modules', 'dotenv')).config({ path: path.join(DASH, '.env.psql'), quiet: true })
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const r = await c.query(
    `select coalesce(extract(epoch from (now() - max(occurred_at))), 999999) age
       from player_events where user_id = $1 and course_code = 'zho_for_eng'`,
    ['81987d60-0c00-4553-8a36-79f83cdf1774'],
  )
  console.log(Math.max(0, Math.round(Number(r.rows[0].age))))
  await c.end()
})().catch(() => { console.log(0); process.exit(0) })
