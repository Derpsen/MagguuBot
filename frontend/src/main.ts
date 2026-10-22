import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
// Website fonts (MagguuUI-Website nuxt.config.ts): Plus Jakarta Sans 400–800, JetBrains Mono 400/500/700.
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/plus-jakarta-sans/latin-800.css';
import '@fontsource/plus-jakarta-sans/latin-ext-400.css';
import '@fontsource/plus-jakarta-sans/latin-ext-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './assets/main.css';

createApp(App).use(router).mount('#app');
