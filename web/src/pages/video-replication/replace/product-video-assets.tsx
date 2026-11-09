import { App, Spin } from "antd";
import { Images, Plus, Sparkles, UserRound, X } from "lucide-react";
import { nanoid } from "nanoid";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getActiveUserScope } from "@/lib/user-scope";
import { PRODUCT_VIDEO_LIMITS, PRODUCT_VIDEO_SLOT_LABEL, type ProductVideoImage, type ProductVideoSlot } from "@/lib/product-video/job";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import type { PickedWorkbenchAsset } from "@/pages/workbench/workbench-asset-picker";
import "./product-video.css";

const WorkbenchAssetPicker = lazy(() => import("@/pages/workbench/workbench-asset-picker").then((module) => ({ default: module.WorkbenchAssetPicker })));
const StudioCastPicker = lazy(() => import("./product-video-cast-picker").then((module) => ({ default: module.StudioCastPicker })));

const HINTS: Record<ProductVideoSlot, string> = {
    products: "替换视频里的商品，多角度更稳",
    models: "替换视频里的人物",
    backgrounds: "替换视频里的场景",
};

export function productVideoThumbUrl(resourceId: string) {
    return `${resourceFileUrl(resourceId)}?variant=thumbnail`;
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
    if (typeof createImageBitmap !== "function") return {};
    try {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    } catch {
        return {};
    }
}

/** 素材库里选的图没有尺寸记录：读一次原图拿宽高。 */
function probeSize(url: string) {
    return new Promise<{ width?: number; height?: number }>((resolve) => {
        const image = new Image();
        const finish = (size: { width?: number; height?: number }) => {
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            resolve(size);
        };
        const timer = window.setTimeout(() => finish({}), 8000);
        image.onload = () => finish({ width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
        image.onerror = () => finish({});
        image.src = url;
    });
}

/**
 * 一类替换素材（商品图、模特图或背景图）：本机上传、拖入、素材库选取；模特图还能从模特库选。
 * generate 是调用方提供的「AI 生成」入口（复刻工作台的 AI 生成模特），生成好后由调用方经 onAdd 放进来。
 */
export function ProductVideoImageSlot({
    slot,
    items,
    disabled,
    onAdd,
    onRemove,
    generate,
    onPendingChange,
}: {
    slot: ProductVideoSlot;
    items: ProductVideoImage[];
    disabled?: boolean;
    onAdd: (images: ProductVideoImage[]) => void;
    onRemove: (id: string) => void;
    generate?: { label: string; onClick: () => void };
    onPendingChange?: (pending: boolean) => void;
}) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [pending, setPending] = useState(0);
    const pendingCallback = useRef(onPendingChange);
    pendingCallback.current = onPendingChange;
    useEffect(() => {
        pendingCallback.current?.(pending > 0);
    }, [pending]);
    const [dragging, setDragging] = useState(false);
    const [picker, setPicker] = useState<"assets" | "figure" | "face" | "pose" | null>(null);
    const limit = PRODUCT_VIDEO_LIMITS[slot];
    const label = PRODUCT_VIDEO_SLOT_LABEL[slot];
    const left = Math.max(0, limit - items.length - pending);

    const accept = (wanted: number) => {
        if (left <= 0) message.warning(`${label}最多 ${limit} 张`);
        else if (wanted > left) message.info(`${label}最多 ${limit} 张，只加了前 ${left} 张`);
        return left;
    };

    const addFiles = async (list: File[]) => {
        const scope = getActiveUserScope();
        const files = list.filter((file) => file.type.startsWith("image/"));
        if (!files.length) {
            message.warning("请选择图片（JPG、PNG 或 WebP）");
            return;
        }
        const accepted = files.slice(0, accept(files.length));
        if (!accepted.length) return;
        setPending((value) => value + accepted.length);
        for (const file of accepted) {
            try {
                const size = await imageSize(file);
                const resource = await uploadResourceFile(file, "image", { fileName: file.name, ...size });
                if (getActiveUserScope() !== scope) return;
                onAdd([{ id: nanoid(10), resourceId: resource.id, name: file.name, width: resource.width || size.width, height: resource.height || size.height }]);
            } catch (error) {
                message.error(`${file.name} 上传失败：${error instanceof Error ? error.message : "请重试"}`);
            } finally {
                setPending((value) => Math.max(0, value - 1));
            }
        }
    };

    const addAssets = async (assets: PickedWorkbenchAsset[]) => {
        const scope = getActiveUserScope();
        const accepted = assets.filter((asset) => asset.kind === "image").slice(0, accept(assets.length));
        setPending((value) => value + accepted.length);
        try {
            const images = await Promise.all(accepted.map(async (asset) => ({ id: nanoid(10), resourceId: asset.resourceId, name: asset.name, ...(await probeSize(resourceFileUrl(asset.resourceId))) })));
            if (images.length && getActiveUserScope() === scope) onAdd(images);
        } finally {
            setPending((value) => Math.max(0, value - accepted.length));
        }
    };

    return (
        <section
            className="pv-slot"
            data-dragging={dragging || undefined}
            aria-label={label}
            onDragOver={(event) => {
                if (disabled || !event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!disabled) void addFiles(Array.from(event.dataTransfer.files));
            }}
        >
            <header className="pv-slot-head">
                <strong>
                    {label}
                    <span>（最多 {limit} 张）</span>
                </strong>
                <span>{items.length ? `${items.length}/${limit}` : HINTS[slot]}</span>
            </header>
            <div className="pv-slot-row">
                {items.map((image) => (
                    <div key={image.id} className="pv-thumb" title={image.name || label}>
                        <img src={productVideoThumbUrl(image.resourceId)} alt={image.name || label} loading="lazy" />
                        {slot === "models" ? <span className="pv-thumb-role">{image.role === "pose" ? "姿势" : image.role === "face" ? "人脸" : "模特"}</span> : null}
                        {disabled ? null : (
                            <button type="button" className="pv-thumb-remove" aria-label={`移除这张${label}`} onClick={() => onRemove(image.id)}>
                                <X size={12} strokeWidth={2.25} />
                            </button>
                        )}
                    </div>
                ))}
                {Array.from({ length: pending }, (_, index) => (
                    <div key={`pending-${index}`} className="pv-thumb" data-pending="true" aria-label="上传中">
                        <Spin size="small" />
                    </div>
                ))}
                {left > 0 && !disabled ? (
                    <>
                        <button type="button" className="pv-add" aria-label={`上传${label}`} onClick={() => input.current?.click()}>
                            <Plus size={18} strokeWidth={1.75} />
                        </button>
                        <button type="button" className="pv-add" aria-label={`从素材库选择${label}`} onClick={() => setPicker("assets")}>
                            <Images size={16} strokeWidth={1.75} />
                            <span>素材库</span>
                        </button>
                        {slot === "models" ? (
                            <button type="button" className="pv-add" aria-label="从模特库选择模特" onClick={() => setPicker("figure")}>
                                <UserRound size={16} strokeWidth={1.75} />
                                <span>模特库</span>
                            </button>
                        ) : null}
                        {slot === "models"
                            ? ["face", "pose"].map((kind) => (
                                  <button key={kind} type="button" className="pv-add" aria-label={kind === "face" ? "选择人脸" : "选择姿势"} onClick={() => setPicker(kind as "face" | "pose")}>
                                      <UserRound size={16} aria-hidden />
                                      <span>{kind === "face" ? "人脸" : "姿势"}</span>
                                  </button>
                              ))
                            : null}
                        {generate ? (
                            <button type="button" className="pv-add" aria-label={generate.label} onClick={generate.onClick}>
                                <Sparkles size={16} strokeWidth={1.75} />
                                <span>{generate.label}</span>
                            </button>
                        ) : null}
                    </>
                ) : null}
            </div>
            <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(event) => {
                    void addFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                }}
            />
            {picker === "assets" ? (
                <Suspense fallback={null}>
                    <WorkbenchAssetPicker open accept={["image"]} maxCount={Math.max(1, left)} slotName={label} onClose={() => setPicker(null)} onPick={(assets) => void addAssets(assets)} />
                </Suspense>
            ) : null}
            {picker && picker !== "assets" ? (
                <Suspense fallback={null}>
                    <StudioCastPicker
                        kind={picker}
                        kinds={["figure", "face", "pose"]}
                        onClose={() => setPicker(null)}
                        onPick={(kind, pick) => {
                            if (!pick.resourceId) {
                                message.info("造型只有文字描述，换人需要带图的人脸或全身模特");
                                return;
                            }
                            setPicker(null);
                            if (accept(1))
                                onAdd([{ id: nanoid(10), resourceId: pick.resourceId, name: pick.name, width: pick.width, height: pick.height, ...(kind === "face" || kind === "pose" || kind === "figure" ? { role: kind } : {}), prompt: pick.prompt }]);
                        }}
                    />
                </Suspense>
            ) : null}
        </section>
    );
}
