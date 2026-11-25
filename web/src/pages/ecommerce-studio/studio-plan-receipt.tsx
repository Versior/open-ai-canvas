import { App, Button } from "antd";
import type { StudioPlanReceipt } from "@/lib/ecommerce-studio/types";
import { useStudioStore } from "./use-studio-store";

export function StudioPlanReceiptPanel({ productId, receipt, current, busy, onRecheck, onRetry }: { productId: string; receipt: StudioPlanReceipt; current: boolean; busy: boolean; onRecheck: () => void; onRetry: () => void }) {
    const state = useStudioStore((store) => store.saveStates[productId]);
    const saveError = useStudioStore((store) => store.saveErrors[productId]);
    const { message } = App.useApp();
    const label =
        receipt.state === "accepted"
            ? state === "saved"
                ? "页面设计已完成 · 已保存"
                : "页面设计已完成 · 已应用到当前商品"
            : receipt.state === "not-accepted"
              ? "页面设计已完成 · 当前输入未应用"
              : receipt.state === "submitted"
                ? "页面设计任务已提交 · 等待结果"
                : receipt.state === "task-failed"
                  ? "页面设计任务失败 · 没有新草稿"
                  : receipt.taskId
                    ? "页面设计任务未完成 · 没有新草稿"
                    : "未取得任务编号 · 没有新草稿";
    return (
        <section className="es-tuner-copy" aria-label="最近页面设计结果" aria-live="polite">
            <strong>{current ? label : "历史策划 · 不用于当前出图"}</strong>
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
            {receipt.issues?.length ? (
                <details>
                    <summary>{receipt.issues.length} 项生成提示</summary>
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
                    <summary>已生成 {receipt.review.length} 屏草稿片段</summary>
                    <ol>
                        {receipt.review.map((screen) => (
                            <li key={screen.index} value={screen.index + 1}>
                                <strong>{screen.title}</strong>
                                {screen.purpose ? <p>页面目的：{screen.purpose}</p> : null}
                                {screen.headline ? <p>文字素材：{screen.headline}</p> : null}
                                <p>画面构思：{screen.visual}</p>
                            </li>
                        ))}
                    </ol>
                </details>
            ) : null}
            {receipt.taskId && (receipt.state === "not-accepted" || receipt.state === "submitted") ? (
                <div>
                    <Button size="small" disabled={!current || busy} onClick={onRecheck}>
                        读取原任务结果（不重复计费）
                    </Button>
                </div>
            ) : null}
            {receipt.state === "task-failed" ? (
                <div>
                    <Button size="small" type="primary" disabled={!current || busy} onClick={onRetry}>
                        重新提交策划
                    </Button>
                </div>
            ) : null}
        </section>
    );
}
