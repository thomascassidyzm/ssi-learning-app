<script setup>
/**
 * Prototype Viewer - Switch between brain network concepts
 */
import { ref } from 'vue'
import BrainNetwork1 from './BrainNetwork1.vue'
import BrainNetwork2 from './BrainNetwork2.vue'
import BrainNetwork3 from './BrainNetwork3.vue'

const emit = defineEmits(['close'])

const prototypes = [
  { id: 1, name: 'Brain Silhouette', component: BrainNetwork1, desc: 'Literal brain shape with nodes filling the space' },
  { id: 2, name: 'Organic Clusters', component: BrainNetwork2, desc: 'Force-directed clustering by SEED families' },
  { id: 3, name: 'Radial Dendrites', component: BrainNetwork3, desc: 'Neural branches growing outward, rings = belts' },
]

const activePrototype = ref(1)
const showSelector = ref(true)

// Mock data props
const mockData = {
  completedSeeds: 42,
  totalSeeds: 668,
  masteryLevel: 0.65,
}

const selectPrototype = (id) => {
  activePrototype.value = id
  showSelector.value = false
}

const handleClose = () => {
  if (!showSelector.value) {
    showSelector.value = true
  } else {
    emit('close')
  }
}
</script>

<template>
  <div class="prototype-viewer">
    <!-- Selector Screen -->
    <div v-if="showSelector" class="selector">
      <header class="header">
        <button class="back-btn" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1>Brain Network Prototypes</h1>
      </header>

      <main class="main">
        <p class="intro">
          Exploring ways to visualize the learning journey as a growing neural network.
          Each LEGO is a node, connections form through practice, and mastery thickens the links.
        </p>

        <div class="prototype-list">
          <button
            v-for="proto in prototypes"
            :key="proto.id"
            class="prototype-card"
            @click="selectPrototype(proto.id)"
          >
            <div class="proto-number">{{ proto.id }}</div>
            <div class="proto-info">
              <h3>{{ proto.name }}</h3>
              <p>{{ proto.desc }}</p>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>

        <div class="mock-data-info">
          <span>Testing with: {{ mockData.completedSeeds }} seeds, {{ Math.round(mockData.masteryLevel * 100) }}% mastery</span>
        </div>
      </main>
    </div>

    <!-- Active Prototype -->
    <component
      v-else
      :is="prototypes.find(p => p.id === activePrototype)?.component"
      v-bind="mockData"
      @close="showSelector = true"
    />
  </div>
</template>

<style scoped>
.prototype-viewer {
  position: fixed;
  inset: 0;
  background: #050508;
  font-family: 'DM Sans', -apple-system, sans-serif;
}

.selector {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
}

.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(255,255,255,0.1);
  color: white;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.header h1 {
  font-size: 1.125rem;
  font-weight: 600;
  color: rgba(255,255,255,0.95);
  margin: 0;
}

.main {
  flex: 1;
  padding: 1rem 1.5rem 2rem;
}

.intro {
  font-size: 0.875rem;
  color: rgba(255,255,255,0.5);
  line-height: 1.6;
  margin: 0 0 2rem 0;
  max-width: 400px;
}

.prototype-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.prototype-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  width: 100%;
}

.prototype-card:hover {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.12);
  transform: translateX(4px);
}

.proto-number {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(194,58,58,0.2), rgba(194,58,58,0.1));
  border: 1px solid rgba(194,58,58,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: #c23a3a;
  flex-shrink: 0;
}

.proto-info {
  flex: 1;
}

.proto-info h3 {
  font-size: 1rem;
  font-weight: 600;
  color: white;
  margin: 0 0 0.25rem 0;
}

.proto-info p {
  font-size: 0.8125rem;
  color: rgba(255,255,255,0.4);
  margin: 0;
  line-height: 1.4;
}

.chevron {
  width: 20px;
  height: 20px;
  color: rgba(255,255,255,0.3);
  flex-shrink: 0;
}

.mock-data-info {
  margin-top: 2rem;
  padding: 0.75rem 1rem;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
  font-size: 0.75rem;
  color: rgba(255,255,255,0.3);
  text-align: center;
}
</style>
