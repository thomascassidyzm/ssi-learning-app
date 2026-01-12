import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/design-tokens.css'
import './styles/global.css'

// Initialize theme from localStorage
const initTheme = () => {
  const savedTheme = localStorage.getItem('ssi-theme') || 'dark'
  document.documentElement.setAttribute('data-theme', savedTheme)
}
initTheme()

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.log('Service worker registration failed:', error)
    })
  })
}

const app = createApp(App)
app.use(router)
app.mount('#app')
