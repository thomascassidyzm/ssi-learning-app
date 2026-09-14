/**
 * The floating tester widget files through the one postbox (job #652).
 *
 * On 2026-09-14 Aran's "choose your course not scrolling" went into
 * tester_feedback, a table nothing polls, and was searched for in
 * bug_reports. Red before the widget was rewired: submit never reached
 * useBugReport and a failed send only ever hit the console.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute: ref({ fullPath: '/' }) }),
  useRoute: () => ({ path: '/' }),
}))
vi.mock('@/composables/useUserRole', () => ({ useUserRole: () => ({ isTester: ref(true), isSsiAdmin: ref(false) }) }))
vi.mock('@/composables/usePreviewTriggers', () => ({ envLabel: ref(null), triggerPreviewCheat: vi.fn() }))
const submit = vi.fn(async () => true)
vi.mock('@/composables/useBugReport', () => ({ useBugReport: () => ({ submit, supabase: ref(null) }) }))

import TesterFeedback from './TesterFeedback.vue'

const supabase = ref({ from: vi.fn() })

async function openAndType(w: ReturnType<typeof mount>, title: string) {
  await w.find('.feedback-fab').trigger('click')
  await w.find('.feedback-input').setValue(title)
}

beforeEach(() => {
  submit.mockClear()
  supabase.value.from.mockClear()
})

describe('TesterFeedback posts to the bug postbox', () => {
  it('FAILURE MODE: a submitted report goes through useBugReport as tester_widget, not into tester_feedback', async () => {
    const w = mount(TesterFeedback, { global: { provide: { supabase } } })
    await openAndType(w, 'choose your course not scrolling')
    await w.find('.feedback-textarea').setValue('Chromebook, 1616x842')
    await w.find('.feedback-submit').trigger('click')
    await flushPromises()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('[Bug] choose your course not scrolling\n\nChromebook, 1616x842', null, null, { source: 'tester_widget' })
    expect(supabase.value.from).not.toHaveBeenCalled()
    expect(w.find('.feedback-confirmation').exists()).toBe(true)
  })

  it('says so on the panel when the send fails, and keeps the form', async () => {
    submit.mockResolvedValueOnce(false)
    const w = mount(TesterFeedback, { global: { provide: { supabase } } })
    await openAndType(w, 'audio stopped')
    await w.find('.feedback-submit').trigger('click')
    await flushPromises()
    expect(w.find('.feedback-submit-error').exists()).toBe(true)
    expect(w.find('.feedback-confirmation').exists()).toBe(false)
    expect((w.find('.feedback-input').element as HTMLInputElement).value).toBe('audio stopped')
  })
})
