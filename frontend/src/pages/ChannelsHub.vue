<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import TabShell from '../components/TabShell.vue';
import { HUB_TABS } from '../lib/navigation';

const components = {
  mapping: defineAsyncComponent(() => import('./Channels.vue')),
  rss: defineAsyncComponent(() => import('./RssFeeds.vue')),
  faq: defineAsyncComponent(() => import('./FaqAutoanswer.vue')),
};
</script>

<template>
  <TabShell section="System" title="Kanäle" :tabs="HUB_TABS.channels" :components="components" />
</template>
