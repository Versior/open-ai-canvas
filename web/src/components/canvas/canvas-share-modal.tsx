import { useEffect, useRef, useState } from "react";
import { App, Button, Input, Modal, Spin } from "antd";
import { Copy, Link2, RefreshCw, Share2, Unlink } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { createCanvasShare, deleteCanvasShare, getCanvasShare, type CanvasShareStatus } from "@/services/api/canvas-share";
import { ApiError } from "@/services/api/request";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { Select } from "@/components/ui/base/select";

export function CanvasShareModal({ projectId, localOnly, onClose, beforeCreate }: { projectId: string; localOnly: boolean; onClose: () => void; beforeCreate: () => Promise<void> }) {
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const [share, setShare] = useState<CanvasShareStatus>({ enabled: false });
    const [expiresDays, setExpiresDays] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<{ message: string; notFound?: boolean } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [phase, setPhase] = useState<"saving" | "creating" | null>(null);
    const [notice, setNotice] = useState("");
    const lifetime = useRef<AbortController | null>(null);
    const operation = useRef(false);
    const requestedShare = useRef(false);
    const firstCloudSave = localOnly && loadError?.notFound && !requestedShare.current;
    const shareUrl = share.token ? `${window.location.origin}/share/canvas/${share.token}` : "";

    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        setLoading(true);
        setLoadError(null);
        void getCanvasShare(projectId, controller.signal)
            .then(({ share }) => {
                if (!controller.signal.aborted) setShare(share);
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setLoadError({ message: error instanceof Error ? error.message : "读取分享状态失败", notFound: error instanceof ApiError && error.status === 404 });
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [attempt, projectId]);

    const copy = async (value = shareUrl) => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            if (!lifetime.current?.signal.aborted) {
                setNotice("");
                message.success("分享链接已复制");
            }
        } catch {
            if (!lifetime.current?.signal.aborted) setNotice("链接已生成，但浏览器未能复制。请选中上方链接手动复制。");
        }
    };

    const create = async (rotate = false) => {
        const signal = lifetime.current?.signal;
        if (!signal || signal.aborted || operation.current || loading || (loadError && !firstCloudSave)) return;
        operation.current = true;
        setLoadError(null);
        setNotice("");
        setPhase("saving");
        let saved = false;
        try {
            await beforeCreate();
            if (signal.aborted) return;
            saved = true;
            requestedShare.current = true;
            setPhase("creating");
            const result = await createCanvasShare(projectId, { expiresDays, rotate }, signal);
            if (signal.aborted) return;
            if (!result.share.enabled || !result.share.token) throw new Error("服务端未返回有效的分享链接");
            setShare(result.share);
            setPhase(null);
            await copy(`${window.location.origin}/share/canvas/${result.share.token}`);
        } catch (error) {
            if (signal.aborted) return;
            const detail = error instanceof Error ? error.message : "请检查网络后重试";
            if (saved) {
                setLoadError({ message: `分享请求未确认：${detail}。请先重新读取分享状态。` });
            } else {
                setNotice(`画布未保存到云端，没有创建分享链接：${detail}`);
            }
        } finally {
            operation.current = false;
            if (!signal.aborted) setPhase(null);
        }
    };

    const revoke = () =>
        modal.confirm({
            title: "停止公开分享？",
            content: "现有分享链接会立即失效，原画布内容不会被删除。",
            okText: "停止分享",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteCanvasShare(projectId);
                setShare({ enabled: false });
                message.success("已停止分享");
            },
        });

    return (
        <Modal
            title={
                <span className="inline-flex items-center gap-2">
                    <Share2 className="size-4" />
                    分享画布
                </span>
            }
            open
            onCancel={onClose}
            footer={null}
            centered
            width={520}
        >
            <Spin spinning={loading}>
                <div className="border-t pt-5" style={{ borderColor: theme.node.stroke }}>
                    <p className="mb-4 text-sm leading-6" style={{ color: theme.node.muted }}>
                        获得链接的人无需登录即可查看。访客可拖动画布节点并临时添加节点，但刷新后会恢复，不能修改原画布或执行生成。
                    </p>
                    {loadError && !firstCloudSave ? (
                        <div role="alert">
                            <p>{loadError.message}</p>
                            <Button disabled={loading} onClick={() => setAttempt((value) => value + 1)}>
                                重新读取分享状态
                            </Button>
                        </div>
                    ) : share.enabled && shareUrl ? (
                        <div className="space-y-4">
                            <Input value={shareUrl} readOnly suffix={<Button type="text" className="!h-7 !w-7 !min-w-7 !p-0" icon={<Copy className="size-3.5" />} onClick={() => void copy()} aria-label="复制分享链接" />} />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="text-xs" style={{ color: theme.node.muted }}>
                                    {share.expiresAt ? `有效至 ${new Date(share.expiresAt).toLocaleString("zh-CN")}` : "长期有效，直至手动停止分享"}
                                </span>
                                <div className="flex gap-2">
                                    <Button icon={<RefreshCw className="size-3.5" />} loading={Boolean(phase)} disabled={loading} onClick={() => void create(true)}>
                                        重新生成链接
                                    </Button>
                                    <Button danger icon={<Unlink className="size-3.5" />} disabled={Boolean(phase) || loading} onClick={revoke}>
                                        停止分享
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Select
                                value={expiresDays}
                                onChange={setExpiresDays}
                                className="min-w-40"
                                options={[
                                    { value: 0, label: "长期有效" },
                                    { value: 7, label: "7 天有效" },
                                    { value: 30, label: "30 天有效" },
                                ]}
                            />
                            <Button type="primary" icon={<Link2 className="size-4" />} loading={Boolean(phase)} disabled={loading} onClick={() => void create(false)}>
                                创建并复制链接
                            </Button>
                        </div>
                    )}
                    {phase ? (
                        <p role="status" className="mt-3 text-sm">
                            {phase === "saving" ? "正在将画布保存到云端…" : "正在创建分享链接…"}
                        </p>
                    ) : null}
                    {notice || firstCloudSave ? (
                        <p role="alert" className="mt-3 text-sm">
                            {notice || "这张画布尚未上云。创建链接时会先保存画布。"}
                        </p>
                    ) : null}
                </div>
            </Spin>
        </Modal>
    );
}
