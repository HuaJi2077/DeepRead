<script setup>
// 居中提示浮层（默认半透明黑底白字），样式复用自阅读器「已是最后一页」边界提示。
// variant="danger" 为警告变体：半透明红底白字（设置页等出错提示）。
// 使用方自管 message 状态与 1.5s 自动消失计时（见各使用方的 showToast）。
// 注意：本组件渲染 position:fixed 元素，使用时放在页面模板根部末尾，
// 避免 transform 祖先（transform 会使 fixed 改为相对其定位）。
defineProps({
  message: { type: String, default: '' },
  danger: { type: Boolean, default: false },
})
</script>

<template>
  <Transition name="toast-tip-fade">
    <div v-if="message" class="toast-tip" :class="{ 'toast-tip--danger': danger }">{{ message }}</div>
  </Transition>
</template>

<style scoped>
.toast-tip {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 14px 28px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 1px;
  pointer-events: none;
  z-index: 20;
}

/* 警告变体：半透明红色底纹 + 白字 */
.toast-tip--danger {
  background: rgba(224, 54, 54, 0.85);
}

.toast-tip-fade-enter-active,
.toast-tip-fade-leave-active {
  transition: opacity 0.2s ease;
}

.toast-tip-fade-enter-from,
.toast-tip-fade-leave-to {
  opacity: 0;
}
</style>
