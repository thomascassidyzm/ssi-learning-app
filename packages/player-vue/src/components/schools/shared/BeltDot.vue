<script setup lang="ts">
type Belt = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'black'

const props = withDefaults(defineProps<{
  belt: Belt
  size?: number
  ring?: boolean
}>(), {
  size: 14,
  ring: false,
})
</script>

<template>
  <span
    class="belt-dot"
    :style="{
      width: `${props.size}px`,
      height: `${props.size}px`,
      background: `var(--schools-belt-${props.belt})`,
      boxShadow: props.ring
        ? 'inset 0 0 0 1.5px rgba(0,0,0,.15)'
        : 'inset 0 0 0 1px rgba(0,0,0,.1)',
    }"
  />
</template>

<style scoped>
.belt-dot {
  display: inline-block;
  border-radius: 50%;
  vertical-align: middle;
  flex: none;
}
</style>
