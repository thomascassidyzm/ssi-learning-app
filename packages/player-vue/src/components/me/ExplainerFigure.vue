<script setup lang="ts">
/**
 * ExplainerFigure — the one place a figure NAME becomes a drawing.
 *
 * The prose module names its illustrations as strings; this map turns each name
 * into the component that draws it. Because the map is typed as a Record over
 * ExplainerFigureName, adding a name to that union without adding a component
 * here fails the typecheck — a figure no component draws cannot ship silently.
 *
 * Both explainer sections render figures through this, so a new drawing is one
 * component plus one line, in one file.
 */
import { computed, type Component } from 'vue'
import type { ExplainerFigureName } from '@/explainer/learnerExplainers'
import CyclePillFigure from './CyclePillFigure.vue'
import ThreeGapsFigure from './ThreeGapsFigure.vue'
import SpacingReturnsFigure from './SpacingReturnsFigure.vue'
import ListeningStretchFigure from './ListeningStretchFigure.vue'
import WornPathFigure from './WornPathFigure.vue'
import ClimbingBandFigure from './ClimbingBandFigure.vue'

const FIGURES: Record<ExplainerFigureName, Component> = {
  'cycle-pill': CyclePillFigure,
  'three-gaps': ThreeGapsFigure,
  'spacing-returns': SpacingReturnsFigure,
  'listening-stretch': ListeningStretchFigure,
  'worn-path': WornPathFigure,
  'climbing-band': ClimbingBandFigure,
}

const props = defineProps<{ name: ExplainerFigureName }>()

const drawing = computed<Component>(() => FIGURES[props.name])
</script>

<template>
  <component :is="drawing" />
</template>
