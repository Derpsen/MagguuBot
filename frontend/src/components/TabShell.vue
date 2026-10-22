<script setup lang="ts">
import { computed, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps<{
  section: string;
  title: string;
  tabs: ReadonlyArray<{ key: string; label: string }>;
  components: Record<string, Component>;
}>();

const route = useRoute();
const router = useRouter();

const activeKey = computed(() => {
  const requested = typeof route.query.tab === 'string' ? route.query.tab : '';
  return props.tabs.some((t) => t.key === requested) ? requested : (props.tabs[0]?.key ?? '');
});

const activeComponent = computed(() => props.components[activeKey.value] ?? null);

function select(key: string): void {
  if (key === activeKey.value) return;
  void router.replace({ query: { ...route.query, tab: key } });
}
</script>

<template>
  <div>
    <p class="mini-label">{{ section }} · {{ title }}</p>
    <nav class="tab-bar mt-3" :aria-label="`${title} Bereiche`">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab-item"
        :class="tab.key === activeKey ? 'tab-item-active' : ''"
        :aria-current="tab.key === activeKey ? 'page' : undefined"
        @click="select(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>
    <div class="mt-6">
      <component :is="activeComponent" v-if="activeComponent" :key="activeKey" />
    </div>
  </div>
</template>
