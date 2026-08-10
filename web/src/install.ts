import { computed, ref, shallowRef } from 'vue';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'restaurant-stock-install-dismissed';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

const deferredPrompt = shallowRef<BeforeInstallPromptEvent | null>(null);
const installed = ref(
  window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true,
);
const dismissed = ref(false);

try {
  const dismissedAt = Number(localStorage.getItem(DISMISS_KEY));
  dismissed.value = Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_MS;
} catch {
  // 隐私模式可能禁止访问本地存储，仍允许本次显示安装入口。
}

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt.value = event as BeforeInstallPromptEvent;
});

window.addEventListener('appinstalled', () => {
  installed.value = true;
  deferredPrompt.value = null;
});

export const showInstallPrompt = computed(
  () => !installed.value && !dismissed.value && (deferredPrompt.value !== null || isIos),
);

export const needsIosInstructions = computed(() => isIos && deferredPrompt.value === null);

export function dismissInstallPrompt() {
  dismissed.value = true;
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // 忽略不可用的本地存储，不影响关闭弹窗。
  }
}

export async function installApp() {
  const prompt = deferredPrompt.value;
  if (!prompt) return;

  await prompt.prompt();
  const choice = await prompt.userChoice;
  deferredPrompt.value = null;
  if (choice.outcome === 'accepted') {
    installed.value = true;
  } else {
    dismissInstallPrompt();
  }
}
