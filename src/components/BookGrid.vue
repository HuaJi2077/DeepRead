<script setup>
/**
 * 书籍网格（书架页与阅读页共用）
 * - 渲染书籍卡片：封面 / 格式角标 / 失效遮罩 / 书名 / 阅读进度百分比
 * - 点击卡片向外抛 open(book, event)，行为由父级决定：
 *     书架页 → 弹出操作菜单（更多信息/重命名/删除）；阅读页 → 打开阅读器
 * - #prepend 插槽：网格首位内容（书架页的「导入电子书」按钮）
 */
import { normalizeProgress } from '@/utils/reading'

defineProps({
  books: { type: Array, default: () => [] },
})
defineEmits(['open'])
</script>

<template>
  <div class="book-grid">
    <slot name="prepend"></slot>

    <div
      v-for="b in books"
      :key="b.id"
      class="book-card"
      :class="{ 'book-invalid': b.invalid }"
      role="button"
      tabindex="0"
      @click="$emit('open', b, $event)"
      @keydown.enter="$emit('open', b, $event)"
    >
      <div class="book-cover">
        <img v-if="b.cover" :src="b.cover" :alt="b.title" loading="lazy" />
        <div v-else class="book-cover-fallback">{{ b.title }}</div>
        <!-- 丢失遮罩：书籍文件不存在时覆盖显示 -->
        <div v-if="b.invalid" class="invalid-mask">已丢失</div>
      </div>
      <div class="book-title" :title="b.title">{{ b.title }}</div>
      <!-- 阅读进度：百分比数字（无进度条） -->
      <div class="book-meta">{{ b.invalid ? '文件已丢失' : `已读 ${normalizeProgress(b.progress)}%` }}</div>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 网格（固定卡片宽度：侧边栏收起/展开不改变书籍与导入按钮大小） ---------- */
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 132px);
  justify-content: start;
  gap: 22px 18px;
}

/* ---------- 书籍卡片（无悬停动画） ---------- */
.book-card {
  cursor: pointer;
  outline: none;
}

.book-card:focus-visible .book-cover {
  box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary, #3964fe);
}

.book-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  background: var(--dsw-alias-fill-secondary, #f1f3f5);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 无封面兜底：书名色块 */
.book-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(150deg, #5b7a9d, #2f4858);
}

/* 丢失态：灰化 + 覆盖「已丢失」 */
.book-invalid .book-cover img,
.book-invalid .book-cover-fallback {
  filter: grayscale(1);
  opacity: 0.55;
}

.invalid-mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  padding: 8px 0;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 2px;
  color: #fff;
  background: rgba(224, 86, 79, 0.9);
}

.book-title {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.book-invalid .book-title {
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.book-meta {
  margin-top: 3px;
  font-size: 11px;
  color: var(--dsw-alias-label-quaternary, #b3b5bf);
}
</style>
