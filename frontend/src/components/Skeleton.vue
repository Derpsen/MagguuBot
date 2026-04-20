<script setup lang="ts">
defineProps<{
  rows?: number;
  class?: string;
}>();
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="i in rows ?? 3"
      :key="i"
      class="skeleton h-14"
      :class="$props.class"
    />
  </div>
</template>
