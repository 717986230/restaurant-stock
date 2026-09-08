<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/api';
import { shrinkImage } from '@/image';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

const props = defineProps<{ itemId: number; hasImage: boolean }>();
const emit = defineEmits<{ changed: [hasImage: boolean] }>();

const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
// 换图之后要绕开浏览器缓存，所以在 URL 上挂一个变动的时间戳
const version = ref(Date.now());

async function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = true;
  try {
    await api.uploadImage(props.itemId, await shrinkImage(file));
    version.value = Date.now();
    emit('changed', true);
    toast('图片已保存');
  } catch (err) {
    toastError(err);
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function remove() {
  if (!await askConfirm({
    title: '删除货品图片？',
    message: '删除后无法恢复，可以稍后重新拍照上传。',
    confirmText: '删除图片',
    tone: 'danger',
  })) return;
  busy.value = true;
  try {
    await api.deleteImage(props.itemId);
    emit('changed', false);
    toast('图片已删除');
  } catch (err) {
    toastError(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="picker">
    <div class="frame" @click="fileInput?.click()">
      <img v-if="hasImage" :src="`/api/items/${itemId}/image?t=${version}`" alt="货品图片" />
      <div v-else class="ph">
        <span class="ic">📷</span>
        <span class="small">拍张照片，采购时不认错货</span>
      </div>
      <div v-if="busy" class="busy">处理中…</div>
    </div>

    <div class="row">
      <button class="btn" :disabled="busy" @click="fileInput?.click()">
        {{ hasImage ? '换一张' : '上传图片' }}
      </button>
      <button v-if="hasImage" class="btn btn-danger" :disabled="busy" @click="remove">删除图片</button>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      hidden
      @change="onPick"
    />
  </div>
</template>

<style scoped>
.picker {
  margin-bottom: 16px;
}

.frame {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg);
  border: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}

.frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ph {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--muted);
}

.ph .ic {
  font-size: 30px;
}

.busy {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 14px;
}
</style>
