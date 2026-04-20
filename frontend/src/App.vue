<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from './composables/useSession';
import AppShell from './components/AppShell.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();

onMounted(async () => {
  await session.refresh();
  if (!session.user.value && route.name !== 'login') {
    router.replace({ name: 'login', query: { next: route.fullPath } });
  }
});
</script>

<template>
  <div v-if="route.name === 'login'">
    <router-view />
  </div>
  <AppShell v-else-if="session.user.value" :user="session.user.value">
    <router-view />
  </AppShell>
  <div v-else class="flex h-full items-center justify-center text-slate-400">
    Lade…
  </div>
</template>
