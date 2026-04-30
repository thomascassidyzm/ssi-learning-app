/**
 * Shared Paddle SDK client + webhook signature verification helper.
 *
 * Env:
 *   PADDLE_API_KEY         — server-side API key (sandbox or live)
 *   PADDLE_ENV             — 'sandbox' (default) or 'production'
 *   PADDLE_WEBHOOK_SECRET  — notification destination signing secret
 */

import { Environment, Paddle } from '@paddle/paddle-node-sdk'

const apiKey = (process.env.PADDLE_API_KEY || '').trim()
const envRaw = (process.env.PADDLE_ENV || 'sandbox').trim().toLowerCase()
const environment = envRaw === 'production' ? Environment.production : Environment.sandbox

export const paddle = new Paddle(apiKey, { environment })

export const webhookSecret = (process.env.PADDLE_WEBHOOK_SECRET || '').trim()
