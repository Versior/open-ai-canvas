import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { creationResultAssetRatio, MediaResult } from "@/pages/create/creation-workspace-messages";
import type { CreationMessage } from "@/pages/create/creation-types";
import type { ImageAsset } from "@/stores/use-asset-store";

const noop = () => {};
const at = "2026-10-28T06:04:00.000Z";

function renderResult(item: Partial<CreationMessage>) {
    return renderToStaticMarkup(
        <MediaResult
            item={{ id: "assistant-1", role: "assistant", mode: "image", content: "图片已生成", createdAt: at, status: "done", taskIds: ["task-1"], settings: { ratio: "16:9", seconds: "", quality: "auto", videoQuality: "", count: "1" }, ...item }}
            onRetryFailure={noop}
            onRefreshResult={noop}
            onRecoverMedia={noop}
            onCreateVariant={noop}
            onContinueCanvas={noop}
            openingCanvas={false}
        />,
    );
}

describe("首页图片结果在加载完成前就占好位置", () => {
    test("图片还没加载出来时按生成比例预留尺寸并显示加载态", () => {
        const markup = renderResult({ resultStorageKeys: ["resource:image-1"], resultUrls: ["/api/resources/image-1/file"] });
        expect(markup).toContain('data-media-state="loading"');
        expect(markup).toContain("aspect-ratio:1.7777");
        expect(markup).toContain('aria-busy="true"');
    });

    test("已知素材尺寸时使用真实宽高比，避免加载完成后跳动", () => {
        const asset = {
            id: "generation_asset",
            kind: "image",
            title: "生成图片",
            category: "material",
            coverUrl: "",
            tags: [],
            status: "confirmed",
            source: "生成任务",
            createdAt: at,
            updatedAt: at,
            metadata: { source: "generation-task", taskId: "task-1", messageId: "assistant-1" },
            data: { dataUrl: "/api/resources/image-1/file", storageKey: "resource:image-1", width: 1824, height: 1024, bytes: 1, mimeType: "image/png" },
        } as ImageAsset;
        expect(creationResultAssetRatio([asset], "resource:image-1")).toBeCloseTo(1824 / 1024);
        expect(creationResultAssetRatio([asset], "resource:other")).toBeUndefined();
        expect(creationResultAssetRatio([{ ...asset, data: { ...asset.data, width: 0 } }], "resource:image-1")).toBeUndefined();
    });

    test("访问地址还在解析、也没有可用 hint 时同样渲染占位块，而不是空白", () => {
        const markup = renderResult({ resultStorageKeys: ["resource:image-1"] });
        expect(markup).toContain('<i class="creation-image-result" data-media-state="loading"');
        expect(markup).not.toContain("暂时没有可预览的结果");
    });

    test("图片生成中显示卡包，并保留真实任务状态", () => {
        const markup = renderResult({ status: "pending", generationStatus: "running" });
        expect(markup).toContain("image-generation-packet");
        expect(markup).toContain("image-pack-progress-title");
        expect(markup).toContain("正在生成图片");
        expect(markup).not.toContain("image-generation-reveal");
    });

    test("尚未取得任务 ID 时显示正在提交，隐藏前端占位进度", () => {
        const markup = renderResult({ status: "pending", taskIds: [], generationStatus: "running", generationStage: "正在准备生成任务", generationProgress: 42 });
        expect(markup).toContain("正在提交");
        expect(markup).not.toContain("准备生成");
        expect(markup).not.toContain("42%");
    });

    test("视频生成仍使用原占位，不播放图片卡包", () => {
        const markup = renderResult({ status: "pending", mode: "video" });
        expect(markup).toContain("creation-media-pending is-video");
        expect(markup).not.toContain("image-generation-packet");
    });

    test("历史图片直接展示，不提供开包弹窗或重复播放入口", () => {
        const markup = renderResult({ taskIds: [], resultUrls: ["/short-drama-styles/fantasy-3d.jpg"] });
        expect(markup).toContain("creation-image-result-grid");
        expect(markup).not.toContain("image-generation-reveal");
        expect(markup).not.toContain("开包查看");
    });

    test.each([
        [{ status: "error", errorKind: "task", error: "模型服务处理失败" }, "生成失败", "重新生成", "is-error"],
        [{ status: "cancelled" }, "已停止生成", "重新生成", "is-neutral"],
        [{ status: "error", errorKind: "sync", error: "网络异常" }, "结果暂未同步", "重新获取结果", "is-warning"],
        [{ status: "error", errorKind: "task", mediaRecoverable: true, error: "保存失败" }, "作品已生成，保存未完成", "重新保存", "is-warning"],
        [{ status: "error", errorKind: "task", error: "上游请求超时（524）" }, "上游超时，费用待核对", "重新生成", "is-warning"],
    ] as const)("异常提示保留状态与恢复操作：%s", (item, title, action, tone) => {
        const markup = renderResult(item);
        expect(markup).toContain(title);
        expect(markup).toContain(action);
        expect(markup).toContain(`creation-media-notice ${tone}`);
        expect(markup).toContain("image-pack-notice-artwork");
        expect(markup).not.toContain("image-generation-packet");
        if (item.status === "cancelled") expect(markup).toContain('role="status"');
        if (item.status === "error") expect(markup).toContain('role="alert"');
        if (title === "上游超时，费用待核对") {
            expect(markup).toContain("重新生成会提交新任务并再次计费");
            expect(markup).not.toContain('class="is-primary"');
        }
        if (title === "结果暂未同步" || title === "作品已生成，保存未完成") expect(markup).toContain("不会重复扣费");
    });
});
