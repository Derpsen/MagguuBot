<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import TabShell from '../components/TabShell.vue';
import { HUB_TABS } from '../lib/navigation';

const components = {
  tags: defineAsyncComponent(() => import('./Tags.vue')),
  autoresponders: defineAsyncComponent(() => import('./Autoresponders.vue')),
  scheduled: defineAsyncComponent(() => import('./Scheduled.vue')),
  'role-panels': defineAsyncComponent(() => import('./RolePanels.vue')),
};
</script>

<template>
  <TabShell section="Community" title="Inhalte" :tabs="HUB_TABS.content" :components="components" />
</template>
