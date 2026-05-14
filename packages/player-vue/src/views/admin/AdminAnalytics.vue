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
    <!-- Page header -->
    <header class="page-head">
      <div class="title-block">
        <h1 class="arsenal page-title">Platform Analytics</h1>
        <p class="page-sub schools-subtle">
          User growth, engagement, retention &amp; friction
        </p>
      </div>
    </header>

    <!-- View pill row -->
    <div class="view-row">
      <span class="schools-kicker view-label">View</span>
      <div class="view-pills" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="view-pill"
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
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.title-block { display: flex; flex-direction: column; gap: 4px; }

.page-title {
  font-size: 32px;
  line-height: 1.05;
  letter-spacing: -0.01em;
}

.page-sub {
  font-size: 13.5px;
  margin-top: 2px;
}

/* View pill row */
.view-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.view-label { letter-spacing: 0.10em; }

.view-pills {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: #f3f1ec;
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-pill);
  flex-wrap: wrap;
}

.view-pill {
  padding: 7px 16px 8px;
  font-size: 12.5px;
  font-weight: 500;
  border: none;
  border-radius: var(--schools-radius-pill);
  background: transparent;
  color: var(--schools-fg-2);
  cursor: pointer;
  font-family: var(--font-body);
  transition: background 160ms ease-out, color 160ms ease-out, box-shadow 160ms ease-out;
}

.view-pill:hover { color: var(--schools-fg); }

.view-pill.is-active {
  background: var(--schools-red);
  color: #fff;
  font-weight: 600;
  box-shadow: var(--schools-shadow-sm);
}

@media (max-width: 768px) {
  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }
  .view-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
