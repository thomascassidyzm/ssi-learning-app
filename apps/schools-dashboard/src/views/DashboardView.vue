<script setup lang="ts">
import Card from '@/components/shared/Card.vue'
import Badge from '@/components/shared/Badge.vue'
</script>

<template>
  <div class="dashboard-view">
    <!-- Page Header -->
    <header class="page-header animate-in">
      <div class="page-title">
        <h1>Dashboard</h1>
        <p class="page-subtitle">Welcome back! Here's what's happening at your school.</p>
      </div>
    </header>

    <!-- Stats Grid -->
    <div class="stats-grid animate-in delay-1">
      <Card variant="stats" accent="red">
        <div class="stat-card">
          <div class="stat-icon">&#128218;</div>
          <div class="stat-content">
            <div class="stat-value">4,287</div>
            <div class="stat-label">Phrases Learned</div>
          </div>
          <Badge variant="success" size="sm" class="stat-badge">+12%</Badge>
        </div>
      </Card>

      <Card variant="stats" accent="gold">
        <div class="stat-card">
          <div class="stat-icon">&#128337;</div>
          <div class="stat-content">
            <div class="stat-value">127</div>
            <div class="stat-label">Hours Learned</div>
          </div>
          <Badge variant="success" size="sm" class="stat-badge">+8%</Badge>
        </div>
      </Card>

      <Card variant="stats" accent="green">
        <div class="stat-card">
          <div class="stat-icon">&#127942;</div>
          <div class="stat-content">
            <div class="stat-value">23</div>
            <div class="stat-label">Belt Promotions</div>
          </div>
          <Badge variant="success" size="sm" class="stat-badge">+5</Badge>
        </div>
      </Card>

      <Card variant="stats" accent="blue">
        <div class="stat-card">
          <div class="stat-icon">&#128101;</div>
          <div class="stat-content">
            <div class="stat-value">284</div>
            <div class="stat-label">Active Students</div>
          </div>
          <Badge variant="info" size="sm" class="stat-badge">92%</Badge>
        </div>
      </Card>
    </div>

    <!-- Quick Actions -->
    <section class="quick-actions animate-in delay-2">
      <Card title="Quick Actions">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </template>
        <div class="actions-grid">
          <router-link to="/classes" class="action-card">
            <div class="action-icon">&#9658;</div>
            <span>Start Session</span>
          </router-link>
          <router-link to="/students" class="action-card">
            <div class="action-icon">&#128100;</div>
            <span>Add Student</span>
          </router-link>
          <router-link to="/teachers" class="action-card">
            <div class="action-icon">&#128188;</div>
            <span>Add Teacher</span>
          </router-link>
          <router-link to="/analytics" class="action-card">
            <div class="action-icon">&#128200;</div>
            <span>View Reports</span>
          </router-link>
        </div>
      </Card>
    </section>

    <!-- Recent Activity Placeholder -->
    <section class="recent-activity animate-in delay-3">
      <Card title="Recent Activity" subtitle="Last 7 days">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </template>
        <div class="activity-placeholder">
          <p class="text-muted">Activity feed will appear here...</p>
        </div>
      </Card>
    </section>
  </div>
</template>

<style scoped>
.dashboard-view {
  max-width: 1200px;
}

.page-header {
  margin-bottom: var(--space-8);
}

.page-title h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  margin-bottom: var(--space-1);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-6);
  margin-bottom: var(--space-8);
}

.stat-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-6);
}

.stat-icon {
  font-size: var(--text-3xl);
  line-height: 1;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  line-height: 1;
  margin-bottom: var(--space-1);
}

.stat-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.stat-badge {
  flex-shrink: 0;
}

/* Quick Actions */
.quick-actions {
  margin-bottom: var(--space-8);
}

.actions-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: var(--text-secondary);
  transition: all var(--transition-base);
}

.action-card:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  transform: translateY(-2px);
}

.action-icon {
  font-size: var(--text-2xl);
}

/* Recent Activity */
.activity-placeholder {
  padding: var(--space-12);
  text-align: center;
}

/* Responsive */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .actions-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .actions-grid {
    grid-template-columns: 1fr;
  }
}
</style>
