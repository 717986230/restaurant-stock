<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { computed, onMounted, ref } from 'vue';
import { api, currentUser } from './api';
import { toastState } from './toast';
import AuthView from './views/AuthView.vue';

const route = useRoute();
const ready = ref(false);

const tabs = [
  { to: '/', icon: '📦', label: '库存' },
  { to: '/moves', icon: '📒', label: '流水' },
  { to: '/stocktake', icon: '🧮', label: '盘点' },
  { to: '/more', icon: '⚙️', label: '更多' },
];

// 详情页/编辑页属于「库存」这条线，底部要保持在库存上高亮
const activeTab = computed(() => (route.path.startsWith('/items') ? '/' : route.path));

// 先问一句还认不认得这台手机，免得页面先闪一下内容再被登录页盖住
onMounted(async () => {
  try {
    const res = await api.me();
    currentUser.value = res.ok && res.user ? res.user : null;
  } catch {
    currentUser.value = null;
  } finally {
    ready.value = true;
  }
});

function onAuthed() {
  // 各个页面的数据都是在挂载时拉的，整页刷新最省事也最不容易漏
  location.replace('/');
}
</script>

<template>
  <AuthView v-if="ready && !currentUser" @done="onAuthed" />

  <template v-else-if="ready">
    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>

    <nav class="tabbar">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" :class="{ active: activeTab === t.to }">
        <span class="ic">{{ t.icon }}</span>
        <span>{{ t.label }}</span>
      </RouterLink>
    </nav>
  </template>

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
