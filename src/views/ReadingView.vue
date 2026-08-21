<script setup>
// 阅读模式页：纯阅读入口
// - 复用书籍网格展示书架内容（无导入/管理按钮，点击书籍即打开阅读器）
// - 阅读器按格式上报阅读进度（EPUB 章节 / PDF 页码 / TXT 滚动位置 → 百分比），
//   经 store 防抖落盘 data/shelf.json，网格卡片以「已读 N%」展示
import { onMounted } from 'vue'
import { useShelfStore } from '@/stores/shelf'
import BookGrid from '@/components/BookGrid.vue'
import BookReader from '@/components/BookReader.vue'

const shelf = useShelfStore()

onMounted(() => {
  shelf.load()
})
</script>

<template>
  <div class="reading-page">
    <!-- 页头：标题 + 数量 + 空态提示 -->
    <header class="reading-header">
      <h1>阅读模式</h1>
      <p class="reading-sub">
        {{ shelf.loading ? '正在加载…' : `总计: ${shelf.books.length}本 | 存在: ${shelf.validCount}本 | 丢失: ${shelf.invalidCount}本 | 点击书籍开始阅读` }}
      </p>
      <!-- 空态提示：紧贴统计行下部居中（页头已为其预留一行空间，避免出现/消失时布局跳动） -->
      <p v-if="!shelf.loading && !shelf.books.length" class="reading-empty">
        书架里还没有书哦，请先到「我的书架」中导入电子书
      </p>
    </header>

    <!-- 书籍网格（无导入按钮，点击 → 打开阅读器；失效书不可打开） -->
    <BookGrid :books="shelf.books" @open="shelf.openReader" />

    <!-- 阅读器弹层（进度由 BookReader 内部经 shelf store 落盘） -->
    <BookReader v-if="shelf.readerBook" :book="shelf.readerBook" @close="shelf.closeReader()" />
  </div>
</template>

<style scoped>
.reading-page {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  /* 顶部内边距收窄：标题上移，避免页头显得过于靠下 */
  padding: 8px 40px 48px;
}

/* ---------- 页头：标题居中、主题蓝 ---------- */
.reading-header {
  margin-bottom: 28px;
}

.reading-header h1 {
  font-size: 30px;
  font-weight: 600;
  text-align: center;
  color: rgb(57, 100, 254);
}

.reading-sub {
  margin-top: 8px;
  font-size: 13px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

/* 空态提示：统计行下部居中；固定行高为页头预留空间，空态消失时布局不跳动 */
.reading-empty {
  margin-top: 10px;
  min-height: 13px; /* 与字号一致，仅占一行基线高度 */
  font-size: 13px;
  line-height: 13px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

@media (max-width: 640px) {
  .reading-page {
    padding: 8px 16px 40px;
  }
}
</style>
