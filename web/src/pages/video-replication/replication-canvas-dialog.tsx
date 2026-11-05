import { App, Button, Checkbox, Input } from "antd";
import { ImagePlus, Images, Recycle, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { videoTeardownProductShot, videoTeardownStoryboardRows, type VideoReplicaMode, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { uploadImage } from "@/services/image-storage";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import type { VideoReplicaOptions } from "./replication-canvas";

const MAX_PRODUCTS = 4;
const MAX_PRODUCT_BYTES = 20 * 1024 * 1024;

type Picked = { id: string; file: File; url: string };

type Props = {
    open: boolean;
    bundle: VideoTeardownBundle;
    analysis: VideoTeardownAnalysis;
    onCancel: () => void;
    /** 商品图已经上传好；返回的 Promise 结束（成功或失败）前按钮保持加载。 */
    onConfirm: (options: VideoReplicaOptions) => Promise<void>;
};

const MODES: { value: VideoReplicaMode; title: string; description: string; icon: typeof Wand2 }[] = [
    { value: "remake", title: "按分镜重拍", description: "照着每一镜的描述重新生成首帧和视频，不用原片画面和出镜人物。", icon: Wand2 },
    { value: "reuse", title: "沿用原片画面", description: "原片关键帧直接当首帧，有商品的镜头先换成你的商品。只用于你自己的或已获授权的视频。", icon: Recycle },
];

/**
 * 去画布复刻：选复刻方式、可选上传商品实拍图，确认后新建画布。
 * 画布里是「先做首帧」的分镜脚本：生成首帧 → 生成视频 → 合并成片，都在画布里完成。
 */
export function ReplicationCanvasDialog({ open, bundle, analysis, onCancel, onConfirm }: Props) {
    const { message } = App.useApp();
    const [mode, setMode] = useState<VideoReplicaMode>("remake");
    const [authorized, setAuthorized] = useState(false);
    const [picked, setPicked] = useState<Picked[]>([]);
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [stage, setStage] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const productShots = useMemo(
        () =>
            videoTeardownStoryboardRows(bundle, analysis.rows)
                .filter(videoTeardownProductShot)
                .map((row) => row.shotNumber),
        [analysis.rows, bundle],
    );
    const pickedRef = useRef(picked);
    pickedRef.current = picked;
    useEffect(() => () => pickedRef.current.forEach((item) => URL.revokeObjectURL(item.url)), []);

    const addFiles = (files: FileList | null) => {
        if (!files?.length) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const tooLarge = images.filter((file) => file.size > MAX_PRODUCT_BYTES);
        if (tooLarge.length) message.warning(`${tooLarge.length} 张图片超过 20 MB，没有加进来`);
        const room = MAX_PRODUCTS - picked.length;
        const accepted = images.filter((file) => file.size <= MAX_PRODUCT_BYTES).slice(0, Math.max(room, 0));
        if (images.length - tooLarge.length > accepted.length) message.info(`商品图最多 ${MAX_PRODUCTS} 张`);
        setPicked((current) => [...current, ...accepted.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, url: URL.createObjectURL(file) }))]);
    };
    const remove = (id: string) =>
        setPicked((current) => {
            const target = current.find((item) => item.id === id);
            if (target) URL.revokeObjectURL(target.url);
            return current.filter((item) => item.id !== id);
        });

    const blocked = mode === "reuse" && !authorized;
    const submit = async () => {
        if (blocked || submitting) return;
        setSubmitting(true);
        try {
            const products = [];
            for (const [index, item] of picked.entries()) {
                setStage(`正在上传商品图 ${index + 1}/${picked.length}`);
                products.push(await uploadImage(item.file));
            }
            if (products.some((item) => item.pendingRemoteUpload)) message.warning("有商品图还没传到服务器，画布会在联网后自动重传；传好之前不能用它生成首帧");
            setStage("正在创建画布");
            await onConfirm({ mode, products, productNote: note });
        } catch (error) {
            message.error(`商品图上传失败：${error instanceof Error ? error.message : "请重试"}`);
        } finally {
            setSubmitting(false);
            setStage("");
        }
    };

    const swapped = picked.length ? productShots : [];
    const keptKeyframes = mode === "reuse" ? bundle.shots.length - swapped.length : 0;
    const steps = [mode === "remake" ? `${bundle.shots.length - swapped.length} 个镜头按描述生成首帧` : keptKeyframes ? `${keptKeyframes} 个镜头直接用原片关键帧当首帧` : "", swapped.length ? `镜头 ${swapped.join("、")} 用商品图换掉原片商品` : ""].filter(
        Boolean,
    );

    return (
        <AppModal
            open={open}
            title="去画布复刻"
            width={600}
            centered
            onCancel={() => !submitting && onCancel()}
            maskClosable={!submitting}
            closable={!submitting}
            footer={
                <div className="vr-dialog-footer">
                    <span className="vr-dialog-stage" role="status">
                        {stage}
                    </span>
                    <Button disabled={submitting} onClick={onCancel}>
                        取消
                    </Button>
                    <Button type="primary" loading={submitting} disabled={blocked} onClick={() => void submit()}>
                        创建画布并打开
                    </Button>
                </div>
            }
        >
            <div className="vr-dialog">
                <fieldset className="vr-dialog-modes">
                    <legend className="vr-dialog-label">复刻方式</legend>
                    <div className="vr-dialog-mode-grid">
                        {MODES.map((item) => (
                            <label key={item.value} className="vr-dialog-mode" data-active={mode === item.value || undefined}>
                                <input type="radio" name="vr-replica-mode" value={item.value} checked={mode === item.value} onChange={() => setMode(item.value)} disabled={submitting} />
                                <item.icon className="vr-dialog-mode-icon" aria-hidden />
                                <span className="vr-dialog-mode-copy">
                                    <strong>{item.title}</strong>
                                    <span>{item.description}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                {mode === "reuse" ? (
                    <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={submitting} className="vr-dialog-check">
                        这是我自己的视频，或者我已获得原作者授权
                    </Checkbox>
                ) : null}

                <div className="vr-dialog-section">
                    <p className="vr-dialog-label">
                        换成我的商品 <span className="vr-dialog-optional">可选</span>
                    </p>
                    <p className="vr-dialog-hint">{productShots.length ? `模型判断镜头 ${productShots.join("、")} 有商品。上传实拍图后，这几镜先用商品图生成首帧再出视频。` : "模型没有判断出有商品的镜头。商品图仍会放进画布，需要时连到对应镜头上。"}</p>
                    <div className="vr-dialog-products">
                        {picked.map((item) => (
                            <figure key={item.id} className="vr-dialog-product">
                                <img src={item.url} alt={item.file.name} />
                                <button type="button" aria-label={`移除 ${item.file.name}`} onClick={() => remove(item.id)} disabled={submitting}>
                                    <X aria-hidden />
                                </button>
                            </figure>
                        ))}
                        {picked.length < MAX_PRODUCTS ? (
                            <button type="button" className="vr-dialog-add" onClick={() => inputRef.current?.click()} disabled={submitting}>
                                <ImagePlus aria-hidden />
                                <span>{picked.length ? "再加一张" : "上传商品图"}</span>
                            </button>
                        ) : null}
                    </div>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(event) => {
                            addFiles(event.target.files);
                            event.target.value = "";
                        }}
                    />
                    <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={80} placeholder="一句话描述商品，例如：白色磨砂瓶身、蓝色瓶盖、瓶身印着品牌字" disabled={submitting} />
                    <p className="vr-dialog-hint">用实拍照片：AI 画不出你的真品，包装上的字也画不准。多给一张细节图效果更好。</p>
                </div>

                <div className="vr-dialog-summary">
                    <Images aria-hidden />
                    <div>
                        <p>
                            会新建一块画布：原视频、{bundle.shots.length} 张关键帧、复刻分镜（{bundle.shots.length} 镜）{picked.length ? `、${picked.length} 张商品图` : ""}和拆解报告。
                        </p>
                        {steps.length ? <p>{steps.join("；")}。</p> : null}
                        <p>在复刻分镜的「更多」里先「生成未完成分镜图」做首帧，检查后「生成未完成视频」，最后「合并成片」；生成按所选模型计费。</p>
                    </div>
                </div>
            </div>
        </AppModal>
    );
}
