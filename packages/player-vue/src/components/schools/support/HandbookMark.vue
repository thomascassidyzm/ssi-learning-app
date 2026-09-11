<script setup lang="ts">
/**
 * The Handbook in place (spec §14 item 4): a quiet question mark beside a
 * control that already carries a data-walk anchor, opening that capability's
 * compiled sentence inline — the code's own description of the thing, from
 * the same pack that gates the build — with a link to the full entry.
 *
 * Nothing here is a second corpus: the entry comes from walkthrough/pack.json
 * by anchor, and if the pack has no entry for the anchor the mark renders
 * nothing at all rather than inventing one.
 */
import { computed, ref } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { handbookEntries } from '@/walkthrough/handbook'

const props = defineProps<{ anchor: string }>()
const { t } = useI18n()

const entry = computed(() => handbookEntries().find((e) => e.anchor === props.anchor) ?? null)
const open = ref(false)

function md(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}
</script>

<template>
  <span v-if="entry" class="hb-mark-wrap">
    <button
      type="button"
      class="hb-mark"
      :aria-expanded="open"
      :aria-label="t('schools.support.handbookMarkAria', 'What this is')"
      :title="entry.title"
      @click="open = !open"
    >?</button>
    <span v-if="open" class="hb-mark-pop" role="note">
      <span class="hb-mark-title">{{ entry.title }}</span>
      <!-- eslint-disable-next-line vue/no-v-html — compiled repo prose, escaped in md() -->
      <span class="hb-mark-what" v-html="md(entry.what)"></span>
      <router-link class="hb-mark-link" :to="{ path: '/schools/handbook', query: { entry: entry.id } }">
        {{ t('schools.support.readInHandbook', 'Read in the Handbook') }}
      </router-link>
    </span>
  </span>
</template>

<style scoped>
.hb-mark-wrap { position: relative; display: inline-flex; align-items: center; margin-left: 6px; }
.hb-mark {
  width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid var(--schools-border, #ddd);
  background: #fff; color: var(--schools-fg-2, #555);
  font-size: 11px; line-height: 1; cursor: pointer; padding: 0;
  font-family: var(--font-body);
}
.hb-mark:hover { color: var(--schools-fg, #222); }
.hb-mark-pop {
  position: absolute; left: 0; top: calc(100% + 6px); z-index: 40;
  width: min(320px, 80vw);
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 14px;
  background: #fff; border: 1px solid var(--schools-border, #ddd); border-radius: 10px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.2);
  font-size: 13px; line-height: 1.5; color: var(--schools-fg, #222); text-align: left;
  font-weight: 400;
}
.hb-mark-title { font-weight: 600; }
.hb-mark-what { color: var(--schools-fg-2, #555); }
.hb-mark-link { color: var(--schools-red, #b3312f); text-decoration: none; font-weight: 600; }
.hb-mark-link:hover { text-decoration: underline; }
</style>
