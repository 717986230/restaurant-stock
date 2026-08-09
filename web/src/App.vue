<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { computed } from 'vue';
import { toastState } from './toast';

const route = useRoute();

const tabs = [
  { to: '/', icon: '📦', label: '库存' },
  { to: '/moves', icon: '📒', label: '流水' },
  { to: '/stocktake', icon: '🧮', label: '盘点' },
  { to: '/more', icon: '⚙️', label: '更多' },
];

// 详情页/编辑页属于「库存」这条线，底部要保持在库存上高亮
const activeTab = computed(() => (route.path.startsWith('/items') ? '/' : route.path));
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>

  <nav class="tabbar">
    <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" :class="{ active: activeTab === t.to }">
      <span class="ic">{{ t.icon }}</span>
      <span>{{ t.label }}</span>
    </RouterLink>
  </nav>

  <Transition name="toast">
    <div v-if="toastState" class="toast" :class="{ err: toastState.error }">{{ toastState.text }}</div>
  </Transition>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
