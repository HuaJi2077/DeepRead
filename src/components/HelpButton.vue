<script setup>
// 帮助按钮 + 帮助菜单弹窗（共用组件）
// - 按钮固定于视口右上角（.help-corner 见 ui.css），在 ChatView / ChatHome 两处复用
// - 弹窗内容解析 data/help.json 渲染（对话指令 / 页面功能 / 快捷键等分区）
// - 底部「GitHub仓库」按钮跳转 json 中的 repoUrl（链接可直接在 json 中修改）
// - help.json 首次打开时拉取一次，之后沿用缓存；加载失败显示降级提示
import { onBeforeUnmount, onMounted, ref } from 'vue'
import iconHelpCircle from '@/assets/icons/help-circle.svg?raw'
import iconGithub from '@/assets/icons/github.svg?raw'

const open = ref(false)
const data = ref(null)

/** Esc 关闭帮助菜单（标准弹窗行为） */
function onKeydown(e) {
  if (e.key === 'Escape' && open.value) open.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/** 打开帮助弹窗：首次点击时拉取 data/help.json */
async function openHelp() {
  open.value = true
  if (data.value) return
  try {
    const res = await fetch('/data/help.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data.value = await res.json()
  } catch {
    data.value = null
  }
}

/** 跳转 GitHub 仓库 */
function openRepo() {
  const url = data.value?.repoUrl
  if (url) window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <!-- 帮助按钮：固定于视口右上角，脱离页面 header 布局流 -->
  <div
    role="button"
    aria-label="帮助"
    class="help-corner ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--xl ds-button--icon-relative-m"
    tabindex="0"
    @click="openHelp"
  >
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child icon-20" v-html="iconHelpCircle"></div>
  </div>

  <!-- 帮助菜单：屏幕居中弹窗（统一 modal 规范：灰描边 + 胶囊按钮），样式见 local-overrides.css -->
  <div v-if="open" class="modal-backdrop" @click="open = false">
    <div
      class="ds-modal-content ds-elevated ds-modal-content--dialog modal-stroke help-modal"
      role="dialog"
      @click.stop
    >
      <div class="ds-modal-content__header-wrapper">
        <div class="ds-modal-content__title">{{ data?.title || '使用帮助' }}</div>
      </div>
      <div class="ds-modal-content__main help-modal__main">
        <template v-if="data">
          <!-- items 为纯字符串数组：每条一段，字符串内 \n 经 pre-line 渲染为换行 -->
          <section v-for="(sec, si) in data.sections || []" :key="si" class="help-section">
            <h3 class="help-section__heading">{{ sec.heading }}</h3>
            <p v-for="(item, ii) in sec.items || []" :key="ii" class="help-item">
              {{ item }}
            </p>
          </section>
        </template>
        <p v-else class="help-modal__error">帮助内容加载失败，请检查 data/help.json</p>
      </div>
      <div class="ds-modal-content__footer">
        <div class="ds-modal-content__button-group">
          <button class="modal-btn help-modal__repo" type="button" @click="openRepo">
            <span class="help-modal__repo-icon" v-html="iconGithub"></span>GitHub仓库
          </button>
          <button class="modal-btn modal-btn--primary" type="button" @click="open = false">
            知道了
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
