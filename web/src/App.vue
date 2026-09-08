<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { computed, onMounted, ref } from 'vue';
import { api, currentUser } from './api';
import { toastState } from './toast';
import AuthView from './views/AuthView.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import InstallPrompt from './components/InstallPrompt.vue';

const route = useRoute();
const ready = ref(false);

const tabs = [
  { to: '/', icon: '📦', label: '库存' },
  { to: '/moves', icon: '📒', label: '流水' },
  { to: '/stocktake', icon: '🧮', label: '盘点' },
  { to: '/receiving', icon: '📎', label: '对货记账' },
  { to: '/more', icon: '⚙️', label: '更多' },
];

// 详情页/编辑页跟着各自的主页面高亮：对货单详情和结账都算「对货记账」这条线
const activeTab = computed(() => {
  const path = route.path;
  if (path.startsWith('/items')) return '/';
  if (path.startsWith('/receiving') || path === '/settlement') return '/receiving';
  return path;
});

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

    <InstallPrompt />
  </template>

  <Transition name="toast">
    <div v-if="toastState" class="toast" :class="{ err: toastState.error }">{{ toastState.text }}</div>
  </Transition>

  <ConfirmDialog />
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
