<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import ChatInput from '@/components/ChatInput.vue'
import HelpButton from '@/components/HelpButton.vue'

// 顶部与模式选择器使用的 SVG 图标（?raw 以字符串导入，供 v-html 使用）
// 模式图标已去重合并为三种图形：闪电 zap=对话模式、打开的书 book-open=阅读模式、
// 图片框 image=我的书架；选中/未选中与测宽共用同一图标，状态区分由容器样式承担
// 新对话/品牌图形与侧边栏共用同一文件（new-chat / logo-mark），
// 顶部 20px 场景用全局工具类 .icon-20 控制渲染尺寸（见 ui.css）
import iconZap from '@/assets/icons/zap.svg?raw'
import iconBookOpen from '@/assets/icons/book-open.svg?raw'
import iconImage from '@/assets/icons/image.svg?raw'
import iconMenuToggle from '@/assets/icons/header-menu.svg?raw'
import iconNewChat from '@/assets/icons/new-chat.svg?raw'
import iconLogoMark from '@/assets/icons/logo-mark.svg?raw'

const ui = useUiStore()
// 发送逻辑由 ChatInput 内部调用 chat store 完成，主页本身不持有对话数据

// 三种模式定义：类型、显示文案、图标（on/off 共用同款，测宽同款）
// 对话模式 → 主页；阅读模式 → 阅读页；我的书架 → 书架页
const modes = [
  { type: 'default', label: '对话模式', iconOn: iconZap, iconOff: iconZap, sizerIcon: iconZap },
  { type: 'expert', label: '阅读模式', iconOn: iconBookOpen, iconOff: iconBookOpen, sizerIcon: iconBookOpen },
  { type: 'vision', label: '我的书架', iconOn: iconImage, iconOff: iconImage, sizerIcon: iconImage },
]

// ============ 模式选择器当前处于「受限模式」 ============
// 产品决策：三个模式已改为按钮形式——点击仅导航到对应页面，
// 选中态恒定为第一项「对话模式」，不随点击切换，不播放滑块动画。
//
// 保留说明（后续恢复「可切换模式」时需要改回以下三处，样式/动画均已保留）：
// 1. selectedIndex：恢复为
//    computed(() => Math.max(0, modes.findIndex((m) => m.type === ui.mode)))
// 2. 模板中选中态判断（aria-checked / _31a22b0 类 / iconOn 切换）：
//    恢复为基于 ui.mode === m.type 的动态判断
// 3. 点击处理：恢复为 @click="ui.setMode(m.type)"
//    （setMode action 仍保留在 stores/ui.js 中，当前未被调用）
// ========================================================

// 选中态滑块固定在第一项「对话模式」（恢复切换时改回 computed 动态计算）
const selectedIndex = 0

// 与原站行为一致：按当前浏览器实际渲染宽度测量最宽项，统一设置 --inline-item-width
// （修复原硬编码 119px 在 Edge 下字体偏宽导致文字被 overflow:hidden 裁剪的问题）
// Edge 专项：offsetWidth 返回整数会丢失亚像素宽度（Edge 字体渲染略宽且常带小数，
// 如实际需要 119.6px 却被取整为 119px，末字仍被裁剪）。
// 因此用 getBoundingClientRect().width 浮点测量 + Math.ceil + 1px 余量，
// 并在下一帧复测一次，规避 Edge 对 CSS 变量变更的延迟生效。
const modeGroupEl = ref(null)
function measureModeWidth() {
  const el = modeGroupEl.value
  if (!el) return
  // 先恢复 auto，让各项回到自然宽度（含当前浏览器真实字体渲染宽度）
  el.style.setProperty('--inline-item-width', 'auto')
  const apply = () => {
    let max = 0
    el.querySelectorAll('[role="radio"]').forEach((item) => {
      max = Math.max(max, item.getBoundingClientRect().width)
    })
    if (max > 0) el.style.setProperty('--inline-item-width', `${Math.ceil(max) + 1}px`)
  }
  apply() // 同步强制布局测量
  requestAnimationFrame(apply) // 下一帧校准（字体/布局完全稳定后）
}

onMounted(() => {
  measureModeWidth()
  requestAnimationFrame(measureModeWidth) // 挂载后下一帧再完整复测一次（先重置 auto）
  document.fonts?.ready.then(measureModeWidth)
  window.addEventListener('resize', measureModeWidth)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureModeWidth)
})
</script>

<template>
  <!-- 首页外层容器 -->
  <div class="_7780f2e">
    <div class="_765a5cd">
      <div class="_660ca72">
        <!-- 顶部占位 header（与原站结构保持一致） -->
        <div class="_2be88ba _1551317">
          <div class="f8d1e4c0 the-header"></div>
          <div class="_1aa2651 the-header" style="padding-right: 58px;">
            <!-- 打开/关闭侧边栏 -->
            <div
              role="button"
              class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--xl ds-button--icon-relative-m"
              tabindex="0"
              @click="ui.toggleSidebar()"
            >
              <div class="ds-button__background"></div>
              <div class="ds-button__icon ds-button__icon--last-child" v-html="iconMenuToggle"></div>
            </div>
            <div class="_9986c0c"></div>
            <div class="_19943ce"></div>
            <div class="_348bebe"></div>
            <!-- 新对话 -->
            <div
              role="button"
              class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--xl ds-button--icon-relative-m"
              tabindex="0"
              style="min-width: 44px;"
              @click="ui.newChat()"
            >
              <div class="ds-button__background"></div>
              <div class="ds-button__icon ds-button__icon--last-child icon-20" v-html="iconNewChat"></div>
            </div>
          </div>
        </div>

        <!-- 首页主内容区：问候语 + 模式选择 + 输入框 -->
        <div class="_9a2f8e4">
          <div class="_5758a85">
            <!-- 欢迎语（固定文案，不随模式切换） -->
            <div class="_6c7e7df">
              <div class="chat-home-logo" v-html="iconLogoMark"></div>
              <span>使用对话模式进行阅读</span>
            </div>
          </div>

          <!--
            模式选择器（当前为受限按钮组：点击仅导航，选中态恒为「对话模式」）
            结构与滑块动画均按原站保留（.c15ec89f 滑块 / --selected-index 变量），
            恢复切换功能时见上方 script 中的「受限模式」注释块
          -->
          <div
            ref="modeGroupEl"
            class="e362e944"
            style="margin-bottom: 38px; margin-top: 6px;"
            data-layout="inline"
          >
            <div
              class="b0db7355"
              role="radiogroup"
              tabindex="0"
              :style="{ '--item-count': modes.length, '--selected-index': selectedIndex }"
            >
              <!-- 选中态滑块背景（固定在第一项，transition 保留待后用） -->
              <div class="c15ec89f">
                <div class="ds-focus-ring" style="border-radius: 120px;"></div>
              </div>

              <!-- 各模式选项（受限：选中态固定为 default 项，点击只导航不改模式） -->
              <div
                v-for="m in modes"
                :key="m.type"
                :data-model-type="m.type"
                role="radio"
                :aria-checked="m.type === 'default'"
                class="_9f2341b _18572c1"
                :class="{ _31a22b0: m.type === 'default' }"
                @click="ui.openModePage(m.type)"
              >
                <!-- 可见项：图标 + 文案（选中图标固定给第一项，切换逻辑保留待后用） -->
                <div class="dfb78875">
                  <div class="ds-icon _2273214" style="font-size: 15px; width: 15px; height: 15px;">
                    <div class="_46d2264" aria-hidden="true">
                      <div style="width: 15px; height: 15px;" v-html="m.type === 'default' ? m.iconOn : m.iconOff"></div>
                    </div>
                  </div>
                  <span class="_321831d">{{ m.label }}</span>
                </div>

                <!-- 隐藏测量项：用于获取该项真实渲染宽度 -->
                <div class="aa40b5de" data-role="measure" aria-hidden="true">
                  <div class="ds-icon _2273214" style="font-size: 15px; width: 15px; height: 15px;" v-html="m.sizerIcon"></div>
                  <span class="_321831d _37fb93d">{{ m.label }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 发送指令后立即跳转对话页，加载提示只出现在对话页（ChatView），
               主页不渲染任何加载状态 -->
          <!-- 底部输入框 -->
          <ChatInput surface="_9996a53" />
        </div>
      </div>
    </div>

    <!-- 帮助按钮 + 帮助菜单弹窗（共用组件，内容解析 data/help.json） -->
    <HelpButton />
  </div>
</template>

<!-- 样式说明：首页 Logo（书本图标）的尺寸控制 .chat-home-logo
     已包含在全局样式 src/styles/ui.css 中，此处无需重复定义。 -->
