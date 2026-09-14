import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { usePairingsTelemetry } from './usePairingsTelemetry'
import { useUserRole } from '@/composables/useUserRole'

function host() {
  const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({ error: null }))
  let tel!: ReturnType<typeof usePairingsTelemetry>
  const Host = defineComponent({
    setup() { tel = usePairingsTelemetry(); return () => h('div') },
  })
  mount(Host, { global: { provide: { supabase: ref({ rpc }) } } })
  return { rpc, tel }
}

describe('usePairingsTelemetry under view-as', () => {
  it('records and flushes pairings in one RPC when nobody is viewing-as', async () => {
    const { rpc, tel } = host()
    tel.recordCyclePlay({ learnerId: 'L', courseCode: 'spa_for_eng', legoIds: ['S0001L01', 'S0001L02'] })
    await tel.flush()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('record_lego_pairings', expect.objectContaining({ _learner_id: 'L', _course_code: 'spa_for_eng' }))
  })

  it('a pair fired while viewing-as never reaches the RPC, even if the flush comes after Exit (#615)', async () => {
    // record_lego_pairings travels as an RPC, which the view-as fetch guard
    // waves through as "the read path" — so the only stop is at the source.
    const role = useUserRole()
    const { rpc, tel } = host()
    // The first flush happens AFTER Exit on purpose: a flush while still
    // viewing-as would be caught by the flush guard and conceal the removal
    // of the creation-time guard (Astra cold-check #617 on #615).
    role.startViewing({ key: 'user:p', userId: 'p', role: 'school_admin', name: 'persona' } as any)
    try {
      tel.recordCyclePlay({ learnerId: 'L', courseCode: 'spa_for_eng', legoIds: ['S0001L01', 'S0001L02'] })
    } finally {
      role.stopViewing()
    }
    await tel.flush()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a pair fired while viewing-as is dropped at flush too, if the flush comes before Exit', async () => {
    const role = useUserRole()
    const { rpc, tel } = host()
    role.startViewing({ key: 'user:p', userId: 'p', role: 'school_admin', name: 'persona' } as any)
    try {
      tel.recordCyclePlay({ learnerId: 'L', courseCode: 'spa_for_eng', legoIds: ['S0001L01', 'S0001L02'] })
      await tel.flush()
    } finally {
      role.stopViewing()
    }
    await tel.flush()
    expect(rpc).not.toHaveBeenCalled()
  })
})
