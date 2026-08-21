<script setup>
// 历史对话搜索页：搜索 data/database/ChatHistory.db 中的历史消息（基础文本匹配）
// - 大标题样式与其他页（阅读模式/我的书架）一致：30px 居中主题蓝
// - 搜索框复刻参考站样式：放大镜 + 输入框 + 清除按钮（有输入时显示）
// - 结果列表每条 = 消息图标（助手=气泡 / 用户=气泡+右下角小头像）
//   + 对话标题/日期 + 关键词高亮摘要（命中词 500 字重主色）
// - 点击结果跳转对应对话页 /chat/:id
// - 输入防抖 300ms 自动搜索，回车立即搜索；请求带序号防竞态
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import iconSearch from '@/assets/icons/search.svg?raw'
import iconSearchClear from '@/assets/icons/search-clear.svg?raw'
import iconSearchChat from '@/assets/icons/search-chat.svg?raw'
import iconSearchUser from '@/assets/icons/search-user.svg?raw'

const router = useRouter()

const query = ref('')
const focused = ref(false)
const results = ref([])
const loading = ref(false)
const searched = ref(false) // 是否已完成一次搜索（区分初始态与空结果态）

let debounceTimer = null
let searchSeq = 0 // 竞态序号：慢请求返回时丢弃，避免旧结果覆盖新搜索

async function runSearch() {
  const q = query.value.trim()
  const seq = ++searchSeq
  if (!q) {
    results.value = []
    searched.value = false
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`)
    const data = await res.json()
    if (seq !== searchSeq) return // 已被更新的搜索取代
    results.value = data.results || []
    searched.value = true
  } catch {
    if (seq !== searchSeq) return
    results.value = []
    searched.value = true
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

watch(query, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(runSearch, 300)
})

function submitSearch() {
  clearTimeout(debounceTimer)
  runSearch()
}

function clearQuery() {
  query.value = ''
}

onBeforeUnmount(() => clearTimeout(debounceTimer))

/** 点击结果：跳转到对应对话页 */
function openConversation(id) {
  if (!id) return
  router.push(`/chat/${id}`)
}

/** 摘要高亮切分：不区分大小写地按关键词切为命中/未命中片段 */
function highlightParts(text, keyword) {
  if (!text) return [{ text: '', hit: false }]
  if (!keyword) return [{ text, hit: false }]
  const parts = []
  const lowerText = text.toLowerCase()
  const lowerKw = keyword.toLowerCase()
  let cursor = 0
  for (;;) {
    const idx = lowerText.indexOf(lowerKw, cursor)
    if (idx === -1) {
      parts.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (idx > cursor) parts.push({ text: text.slice(cursor, idx), hit: false })
    parts.push({ text: text.slice(idx, idx + keyword.length), hit: true })
    cursor = idx + keyword.length
  }
  return parts
}

/** 日期展示：同年省略年份（参考站「8月16日」风格） */
function formatDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
</script>

<template>
  <div class="search-page">
    <!-- 页头：与其他页一致的大标题样式 -->
    <header class="search-header">
      <h1>对话搜索</h1>
      <p class="search-sub">输入关键词搜索历史对话消息，点击结果跳转到对应对话</p>
    </header>

    <!-- 搜索框：放大镜 + 输入 + 清除按钮 -->
    <div class="search-box" :class="{ 'search-box--focused': focused }">
      <div class="search-box__icon" aria-hidden="true"><span v-html="iconSearch"></span></div>
      <input
        v-model="query"
        class="search-box__input"
        type="text"
        role="searchbox"
        placeholder="搜索对话内容..."
        @keydown.enter="submitSearch"
        @focus="focused = true"
        @blur="focused = false"
      />
      <button
        v-if="query"
        class="search-box__clear"
        type="button"
        aria-label="清空搜索词"
        @click="clearQuery"
      >
        <span v-html="iconSearchClear"></span>
      </button>
    </div>

    <!-- 结果列表：与搜索框同宽居中 -->
    <div class="search-results">
      <p v-if="loading" class="search-state">正在搜索…</p>
      <p v-else-if="!searched" class="search-state">输入关键词开始搜索历史对话</p>
      <p v-else-if="!results.length" class="search-state">未找到相关对话</p>
      <template v-else>
        <div
          v-for="(item, i) in results"
          :key="`${item.conversationId}-${i}`"
          class="search-result"
          role="button"
          tabindex="0"
          @click="openConversation(item.conversationId)"
          @keydown.enter="openConversation(item.conversationId)"
        >
          <!-- 消息图标：助手=气泡；用户=气泡 + 右下角小头像 -->
          <div class="search-result__avatar">
            <div class="search-result__avatar-icon" aria-hidden="true">
              <span v-html="iconSearchChat"></span>
            </div>
            <div v-if="item.role === 'user'" class="search-result__avatar-user" aria-hidden="true">
              <span v-html="iconSearchUser"></span>
            </div>
          </div>
          <div class="search-result__body">
            <div class="search-result__title-row">
              <div class="search-result__title">{{ item.title }}</div>
              <div class="search-result__date">{{ formatDate(item.createdAt) }}</div>
            </div>
            <div class="search-result__snippet">
              <span
                v-for="(part, j) in highlightParts(item.snippet, query.trim())"
                :key="j"
                :class="{ 'search-result__snippet-hit': part.hit }"
              >{{ part.text }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-page {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 8px 40px 48px;
}

/* ---------- 页头：与其他页一致（30px 居中主题蓝） ---------- */
.search-header {
  margin-bottom: 24px;
}

.search-header h1 {
  font-size: 30px;
  font-weight: 600;
  text-align: center;
  color: rgb(57, 100, 254);
}

.search-sub {
  margin-top: 8px;
  font-size: 13px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

/* ---------- 搜索框 ---------- */
.search-box {
  display: flex;
  align-items: center;
  max-width: 660px;
  min-height: 52px;
  margin: 0 auto 10px;
  padding: 6px 10px 6px 6px;
  border: 1px solid var(--dsw-alias-border-l4, #dcdcdc);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  transition: border-color 0.2s;
}

.search-box--focused {
  border-color: var(--dsw-alias-brand-primary, #3964fe);
}

.search-box__icon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-primary, #1f2329);
}

.search-box__input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 16px;
  line-height: 24px;
  color: var(--dsw-alias-label-primary, #1f2329);
}

.search-box__input::placeholder {
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.search-box__clear {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8f919f);
  cursor: pointer;
}

.search-box__clear:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}

/* ---------- 结果列表 ---------- */
.search-results {
  max-width: 660px;
  margin: 0 auto;
}

.search-state {
  padding: 18px 0 40px;
  text-align: center;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.search-result {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 67px;
  padding: 10px 12px 10px 10px;
  border-radius: 16px;
  text-align: left;
  cursor: pointer;
}

.search-result:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5);
}

/* 消息图标：40px 圆形描边；用户消息右下角叠加小头像 */
.search-result__avatar {
  position: relative;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.search-result__avatar-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}

.search-result__avatar-user {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  color: var(--dsw-alias-label-tertiary, #81858c);
}

.search-result__avatar-user :deep(svg) {
  width: 10px;
  height: 10px;
}

.search-result__body {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.search-result__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.search-result__title {
  min-width: 0;
  font-size: 15px;
  line-height: 25px;
  color: var(--dsw-alias-label-primary, #1f2329);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-result__date {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.search-result__snippet {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, #61666b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 命中关键词：主色 + 500 字重（参考站高亮样式） */
.search-result__snippet-hit {
  color: var(--dsw-alias-label-primary, #1f2329);
  font-weight: 500;
}

@media (max-width: 640px) {
  .search-page {
    padding: 8px 16px 40px;
  }
}
</style>
