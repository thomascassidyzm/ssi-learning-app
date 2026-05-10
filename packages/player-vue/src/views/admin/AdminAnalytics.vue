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
  { id: 'friction', label: 'Friction' },
] as const

type TabId = typeof tabs[number]['id']
const activeTab = ref<TabId>('overview')
</script>

<template>
  <div class="admin-analytics">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Platform Analytics</h1>
        <div class="metrics">
          <span class="metric">User growth, engagement, retention &amp; friction</span>
        </div>
      </div>
    </header>

    <!-- Tab nav — segmented pill (canon: see AdminCourses' Sort toggle) -->
    <div class="filters-bar">
      <span class="frost-eyebrow">View</span>
      <div class="tab-toggle" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab-btn"
          :class="{ 'is-active': activeTab === tab.id }"
          :aria-selected="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
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
  gap: var(--space-6);
}

/* Page header — canon §5.1 */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
}

.title-block h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0 0 var(--space-2);
}

.metrics {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Tab toggle — segmented pill, canon filters-bar §5.2 */
.filters-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.tab-toggle {
  display: inline-flex;
  background: rgba(44, 38, 34, 0.05);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
  flex-wrap: wrap;
}

.tab-btn {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 6px 14px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  color: var(--ink-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tab-btn:hover { color: var(--ink-primary); }

.tab-btn.is-active {
  background: var(--ssi-red);
  color: #fff;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.10), 0 4px 12px rgba(194, 58, 58, 0.20);
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .filters-bar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
