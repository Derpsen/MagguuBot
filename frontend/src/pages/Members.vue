<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import TabShell from '../components/TabShell.vue';
import { HUB_TABS } from '../lib/navigation';

const components = {
  xp: defineAsyncComponent(() => import('./Leaderboard.vue')),
  reputation: defineAsyncComponent(() => import('./Reputation.vue')),
  reminders: defineAsyncComponent(() => import('./Reminders.vue')),
};
</script>

<template>
  <TabShell section="Community" title="Mitglieder" :tabs="HUB_TABS.members" :components="components" />
</template>
