<script setup>
import LearningPlayer from './components/LearningPlayer.vue'
</script>

<template>
  <LearningPlayer />
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600&family=DM+Serif+Display:ital@0;1&display=swap');

:root {
  /* SSi Red */
  --ssi-red: #E63946;
  --ssi-red-soft: rgba(230, 57, 70, 0.12);
  --ssi-red-glow: rgba(230, 57, 70, 0.35);

  /* Typography */
  --font-display: 'DM Serif Display', Georgia, serif;
  --font-body: 'DM Sans', -apple-system, sans-serif;

  /* Timing */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Dark Theme (default) */
:root, [data-theme="dark"] {
  --bg-primary: #0D0D0F;
  --bg-secondary: #1A1A1D;
  --bg-tertiary: #242428;
  --bg-elevated: #2C2C30;
  --text-primary: #FAFAFA;
  --text-secondary: rgba(250, 250, 250, 0.7);
  --text-tertiary: rgba(250, 250, 250, 0.45);
  --text-muted: rgba(250, 250, 250, 0.25);
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-light: rgba(255, 255, 255, 0.12);
  --shadow-elevated: 0 8px 32px rgba(0, 0, 0, 0.5);
}

/* Light Theme */
[data-theme="light"] {
  --bg-primary: #FAFAFA;
  --bg-secondary: #F0F0F2;
  --bg-tertiary: #E8E8EB;
  --bg-elevated: #FFFFFF;
  --text-primary: #1A1A1D;
  --text-secondary: rgba(26, 26, 29, 0.7);
  --text-tertiary: rgba(26, 26, 29, 0.5);
  --text-muted: rgba(26, 26, 29, 0.25);
  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-light: rgba(0, 0, 0, 0.1);
  --shadow-elevated: 0 8px 32px rgba(0, 0, 0, 0.1);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-body);
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  transition: background-color 0.3s ease, color 0.3s ease;
}
</style>
