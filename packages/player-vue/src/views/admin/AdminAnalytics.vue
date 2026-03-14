<script setup lang="ts">
import { ref } from 'vue'
import OverviewTab from './analytics/OverviewTab.vue'
import GrowthTab from './analytics/GrowthTab.vue'
import EngagementTab from './analytics/EngagementTab.vue'
import RetentionTab from './analytics/RetentionTab.vue'
import FrictionTab from './analytics/FrictionTab.vue'

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'growth', label: 'Growth' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'retention', label: 'Retention' },
  { id: 'friction', label: 'Friction Map' },
] as const

type TabId = typeof tabs[number]['id']
const activeTab = ref<TabId>('overview')
</script>

<template>
  <div class="admin-analytics">
    <header class="page-header animate-in">
      <h1 class="page-title">Platform Analytics</h1>
      <p class="page-subtitle">User growth, engagement metrics, retention, and friction analysis</p>
    </header>

    <div class="tab-nav animate-in delay-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <OverviewTab v-if="activeTab === 'overview'" />
    <GrowthTab v-if="activeTab === 'growth'" />
    <EngagementTab v-if="activeTab === 'engagement'" />
    <RetentionTab v-if="activeTab === 'retention'" />
    <FrictionTab v-if="activeTab === 'friction'" />
  </div>
</template>

<style scoped>
.admin-analytics {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 24px);
  max-width: 1200px;
}

.page-header {
  margin-bottom: var(--space-2, 8px);
}

.page-title {
  font-family: var(--font-display, 'Noto Sans JP', system-ui, sans-serif);
  font-size: var(--text-3xl, 1.875rem);
  font-weight: var(--font-bold, 700);
  margin: 0 0 var(--space-1, 4px);
  color: var(--text-primary);
}

.page-subtitle {
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-secondary);
  margin: 0;
}

.tab-nav {
  display: flex;
  gap: var(--space-1, 4px);
  background: var(--bg-secondary);
  padding: var(--space-1, 4px);
  border-radius: var(--radius-lg, 10px);
}

.tab-btn {
  flex: 1;
  padding: var(--space-3, 10px) var(--space-4, 16px);
  border: none;
  border-radius: var(--radius-md, 8px);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--font-medium, 500);
  cursor: pointer;
  transition: all var(--transition-base, 0.15s);
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-weight: var(--font-semibold, 600);
}

@media (max-width: 768px) {
  .tab-nav {
    flex-direction: column;
  }
}
</style>
