import { createApp } from 'vue'
import { clerkPlugin } from '@clerk/vue'
import './style.css'
import App from './App.vue'
import { loadConfig, isClerkConfigured } from './config/env'

const config = loadConfig()
const app = createApp(App)

// Configure Clerk if publishable key is available
if (isClerkConfigured(config)) {
  app.use(clerkPlugin, {
    publishableKey: config.clerk.publishableKey,
  })
}

app.mount('#app')

// Remove loading state once app is mounted
document.getElementById('app')?.classList.remove('app-loading')
