import { createApp } from 'vue'
import './style.css'
// Schools design system (CSS variables for schools dashboard components)
import './styles/design-tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)

// Configure router
app.use(router)

app.mount('#app')

// Remove loading state once app is mounted
document.getElementById('app')?.classList.remove('app-loading')
