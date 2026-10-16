/**
 * 节点内的交互元素与画布拖拽的分界。
 *
 * 节点卡是「一个可拖动的整体」，里面又塞满了按钮、输入框、下拉。用户按在按钮上
 * 是想点它，不是想拖节点——但 mousedown 会冒泡到节点的落点处理器，画布把它当成
 * 拖拽开始，随后的 click 就被吃掉了。表现出来就是**按钮要点两次才生效**，
 * 而且每次点都启动一次拖拽，手感发黏。
 *
 * 判据只此一份：`canvas-node-prompt-panel` 与电商卡片都读它，不各写一条选择器列表——
 * 两份一定会分叉，然后某一类控件在某个节点上突然要点两次。
 */

/** 命中这些标签（或显式的 `data-canvas-no-drag`）时，按下不算拖拽。 */
const INTERACTIVE_SELECTOR = "button, a, input, textarea, select, label, summary, [contenteditable=\"true\"], [data-canvas-no-drag], [role=\"button\"], [role=\"option\"], [role=\"combobox\"], [role=\"textbox\"]";

export function isCanvasNodeInteractiveTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));
}

/**
 * 挂在节点内容容器的 `onMouseDown` 上：按在交互元素上就不让事件冒泡到画布。
 *
 * 用冒泡阶段而不是捕获阶段：捕获阶段拦下来，控件自己就收不到事件了。
 * 挂在容器最外层而不是逐个控件：逐个加一定会漏，而漏掉的那个
 * 就是下次「这个按钮怎么要点两次」。
 */
export function stopCanvasDragFromInteractive(event: { target: EventTarget | null; stopPropagation: () => void }) {
    if (isCanvasNodeInteractiveTarget(event.target)) event.stopPropagation();
}
