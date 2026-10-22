<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import TabShell from '../components/TabShell.vue';
import { HUB_TABS } from '../lib/navigation';

const components = {
  warnings: defineAsyncComponent(() => import('./Warnings.vue')),
  tickets: defineAsyncComponent(() => import('./Tickets.vue')),
  'audit-log': defineAsyncComponent(() => import('./AuditLog.vue')),
};
</script>

<template>
  <TabShell section="Community" title="Moderation" :tabs="HUB_TABS.moderation" :components="components" />
</template>
