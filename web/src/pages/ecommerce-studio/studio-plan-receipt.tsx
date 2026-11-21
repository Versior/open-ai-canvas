import { App, Button } from "antd";
import type { StudioPlanReceipt } from "@/lib/ecommerce-studio/types";
import { useStudioStore } from "./use-studio-store";

export function StudioPlanReceiptPanel({ productId, receipt, current, busy, onRecheck }: { productId: string; receipt: StudioPlanReceipt; current: boolean; busy: boolean; onRecheck: () => void }) {
    const state = useStudioStore((store) => store.saveStates[productId]);
    const saveError = useStudioStore((store) => store.saveErrors[productId]);
    const { message } = App.useApp();
    const label =
        receipt.state === "accepted"
            ? state === "saved"
                ? "文本已完成 · 策划已采用并保存"
                : "文本已完成 · 当前本机已采用"
            : receipt.state === "not-accepted"
              ? "文本已完成 · 这次结果未采用"
              : receipt.state === "submitted"
                ? "已取得任务编号 · 尚未确认可用策划"
                : receipt.taskId
                  ? "文本任务未完成 · 没有新策划"
                  : "未取得任务编号 · 没有新策划";
    return (
        <section className="es-tuner-copy" aria-label="最近策划结果" aria-live="polite">
            <strong>{label}</strong>
            {receipt.taskId ? (
                <span>
                    任务编号：<code>{receipt.taskId}</code>
                </span>
            ) : null}
            {receipt.message ? <p className="es-prompt-note">{receipt.message}</p> : null}
            {state === "error" ? (
                <p role="alert">
                    商品未保存到服务器：{saveError}
                    <Button
                        size="small"
                        onClick={() =>
                            void useStudioStore
                                .getState()
                                .flush(productId)
                                .catch((error) => message.error(error instanceof Error ? error.message : "商品未保存"))
                        }
                    >
                        只重试保存（不扣费）
                    </Button>
                </p>
            ) : null}
            {!current ? <p className="es-field-hint">这次策划对应的商品资料或出图要求已改变，不能套用到当前输入。</p> : null}
            {receipt.issues?.length ? (
                <details>
                    <summary>{receipt.issues.length} 项核对说明</summary>
                    <ul>
                        {receipt.issues.map((issue, index) => (
                            <li key={index}>
                                {issue.index === undefined ? "整套" : `第 ${issue.index + 1} 屏`} · {issue.field}：{issue.message}
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
            {receipt.review?.length ? (
                <details>
                    <summary>审阅 {receipt.review.length} 屏已通过的内容（整套未采用，不能出图）</summary>
                    <ol>
                        {receipt.review.map((screen) => (
                            <li key={screen.index} value={screen.index + 1}>
                                <strong>{screen.title}</strong>
                                {screen.purpose ? <p>本屏目的：{screen.purpose}</p> : null}
                                {screen.headline ? <p>主标题：{screen.headline}</p> : null}
                                <p>画面摘要：{screen.visual}</p>
                            </li>
                        ))}
                    </ol>
                </details>
            ) : null}
            {receipt.taskId && (receipt.state === "not-accepted" || receipt.state === "submitted") ? (
                <div>
                    <Button size="small" disabled={!current || busy} onClick={onRecheck}>
                        重验原任务（不扣费）
                    </Button>
                </div>
            ) : null}
        </section>
    );
}
