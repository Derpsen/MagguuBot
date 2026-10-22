<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{
  icon?: Component;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="empty-state-surface flex flex-col items-start py-6 text-left">
    <h3 class="text-[0.95rem] font-semibold text-silver-200">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-md text-sm leading-relaxed text-slate-400">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
