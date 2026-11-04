import { App, Dropdown, Spin, Tooltip } from "antd";
import { Images, Plus, Star, X } from "lucide-react";
import { nanoid } from "nanoid";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { STUDIO_VIEW_LABEL, type StudioPhoto, type StudioPhotoView, type StudioProduct } from "@/lib/ecommerce-studio/types";
import type { PickedWorkbenchAsset } from "@/pages/workbench/workbench-asset-picker";
import { studioImageUrl } from "./studio-parts";
import { guessStudioView, studioImageFiles, studioViewPatch, uploadStudioPhoto } from "./studio-upload";
import { useStudioStore } from "./use-studio-store";

const WorkbenchAssetPicker = lazy(() => import("@/pages/workbench/workbench-asset-picker").then((module) => ({ default: module.WorkbenchAssetPicker })));

export type StudioUploadKind = "photos" | "references";

const LIMITS: Record<StudioUploadKind, number> = { photos: 8, references: 3 };
const LABELS: Record<StudioUploadKind, string> = { photos: "商品图", references: "参考图" };
const VIEW_ITEMS = (Object.keys(STUDIO_VIEW_LABEL) as StudioPhotoView[]).map((view) => ({ key: view, label: view === "tag" ? "吊牌（只读文字）" : STUDIO_VIEW_LABEL[view] }));

export type StudioPhotoPatch = Partial<Pick<StudioPhoto, "view" | "truth">>;

/** 素材库里选的图没有尺寸记录：读一次原图拿宽高，同款版式要按它定画幅。 */
function probeSize(url: string) {
    return new Promise<{ width?: number; height?: number }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
        image.onerror = () => resolve({});
        image.src = url;
    });
}

/**
 * 商品图与参考图的上传：本机上传、素材库选取、拖入和粘贴都走这里。
 * 第一次加图时才把新商品写到服务器（ensure），之后每张图上传完立即保存。
 */
export function useStudioUploads(ensure: () => string) {
    const { message } = App.useApp();
    const update = useStudioStore((state) => state.update);
    const [pending, setPending] = useState<Record<StudioUploadKind, number>>({ photos: 0, references: 0 });

    const room = useCallback(
        (kind: StudioUploadKind, productId: string, wanted: number) => {
            const current = useStudioStore.getState().products.find((item) => item.id === productId);
            const left = LIMITS[kind] - (current?.[kind].length || 0);
            if (left <= 0) message.warning(`${LABELS[kind]}最多 ${LIMITS[kind]} 张`);
            else if (wanted > left) message.info(`${LABELS[kind]}最多 ${LIMITS[kind]} 张，只加了前 ${left} 张`);
            return { left: Math.max(0, left), offset: current?.[kind].length || 0 };
        },
        [message],
    );

    const append = useCallback(
        (productId: string, kind: StudioUploadKind, photo: StudioPhoto) =>
            // 操作可能在保存冲突后被重新套用，按 ID 去重保证只追加一次。
            update(productId, (product) => (product[kind].some((item) => item.id === photo.id) || product[kind].length >= LIMITS[kind] ? product : { ...product, [kind]: [...product[kind], photo] }), { immediate: true }),
        [update],
    );

    const addFiles = useCallback(
        async (kind: StudioUploadKind, list: FileList | File[] | null | undefined) => {
            const files = studioImageFiles(list);
            if (!files.length) {
                message.warning("请选择图片（JPG、PNG 或 WebP）");
                return;
            }
            const productId = ensure();
            const { left, offset } = room(kind, productId, files.length);
            const accepted = files.slice(0, left);
            if (!accepted.length) return;
            setPending((current) => ({ ...current, [kind]: current[kind] + accepted.length }));
            for (const [index, file] of accepted.entries()) {
                try {
                    const uploaded = await uploadStudioPhoto(file, offset + index);
                    append(productId, kind, kind === "photos" ? uploaded : { ...uploaded, view: "other", truth: false });
                } catch (error) {
                    message.error(`${file.name} 上传失败：${error instanceof Error ? error.message : "请重试"}`);
                } finally {
                    setPending((current) => ({ ...current, [kind]: Math.max(0, current[kind] - 1) }));
                }
            }
        },
        [append, ensure, message, room],
    );

    const addAssets = useCallback(
        async (kind: StudioUploadKind, assets: PickedWorkbenchAsset[]) => {
            const productId = ensure();
            const { left, offset } = room(kind, productId, assets.length);
            const accepted = assets.filter((asset) => asset.kind === "image").slice(0, left);
            setPending((current) => ({ ...current, [kind]: current[kind] + accepted.length }));
            for (const [index, asset] of accepted.entries()) {
                const size = await probeSize(studioImageUrl(asset.resourceId));
                const view = kind === "photos" ? guessStudioView(asset.name, offset + index) : "other";
                append(productId, kind, { id: nanoid(10), resourceId: asset.resourceId, url: `/api/resources/${asset.resourceId}/file`, view, truth: kind === "photos" && view !== "tag", name: asset.name, ...size, addedAt: new Date().toISOString() });
                setPending((current) => ({ ...current, [kind]: Math.max(0, current[kind] - 1) }));
            }
        },
        [append, ensure, room],
    );

    return { pending, addFiles, addAssets };
}

export function StudioUploadBox({
    kind,
    hint,
    product,
    pending,
    onFiles,
    onAssets,
    onRemove,
    onPatch,
}: {
    kind: StudioUploadKind;
    hint: string;
    product: StudioProduct;
    pending: number;
    onFiles: (files: File[]) => void;
    onAssets: (assets: PickedWorkbenchAsset[]) => void;
    onRemove: (photo: StudioPhoto) => void;
    /** 商品图可以改视角、点亮或取消星标（外观依据）；参考图不传。 */
    onPatch?: (photo: StudioPhoto, patch: StudioPhotoPatch) => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [picking, setPicking] = useState(false);
    const items = product[kind];
    const full = items.length + pending >= LIMITS[kind];
    const label = LABELS[kind];
    return (
        <section
            className="es-upload"
            data-dragging={dragging || undefined}
            aria-label={label}
            onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                onFiles(Array.from(event.dataTransfer.files));
            }}
        >
            <header className="es-upload-head">
                <strong>{label}</strong>
                <span>{items.length ? `${items.length}/${LIMITS[kind]}` : hint}</span>
            </header>
            <div className="es-upload-row">
                {items.map((photo) => {
                    const truth = photo.truth && photo.view !== "tag";
                    return (
                        <div key={photo.id} className="es-thumb" data-truth={truth || undefined} title={kind === "references" ? photo.name || "参考图" : undefined}>
                            <img src={studioImageUrl(photo.resourceId, true)} alt={photo.name || label} loading="lazy" />
                            {kind === "photos" && onPatch ? (
                                <>
                                    {photo.view === "tag" ? null : (
                                        <Tooltip title={truth ? "外观依据：出图以这张为准，点一下取消" : "点亮星标，出图时以这张为外观依据"} mouseEnterDelay={0.3}>
                                            <button type="button" className="es-thumb-star" aria-pressed={truth} aria-label={truth ? "取消外观依据星标" : "设为外观依据"} onClick={() => onPatch(photo, { truth: !truth })}>
                                                <Star size={11} strokeWidth={2} fill={truth ? "currentColor" : "none"} />
                                            </button>
                                        </Tooltip>
                                    )}
                                    <Dropdown trigger={["click"]} rootClassName="es-portal" menu={{ items: VIEW_ITEMS, selectable: true, selectedKeys: [photo.view], onClick: ({ key }) => onPatch(photo, studioViewPatch(photo, key as StudioPhotoView)) }}>
                                        <button type="button" className="es-thumb-view" aria-label={`视角：${STUDIO_VIEW_LABEL[photo.view]}，点击修改`}>
                                            {STUDIO_VIEW_LABEL[photo.view]}
                                        </button>
                                    </Dropdown>
                                </>
                            ) : null}
                            <button type="button" className="es-thumb-remove" aria-label={`移除这张${label}`} onClick={() => onRemove(photo)}>
                                <X size={12} strokeWidth={2.25} />
                            </button>
                        </div>
                    );
                })}
                {Array.from({ length: pending }, (_, index) => (
                    <div key={`pending-${index}`} className="es-thumb" data-pending="true" aria-label="上传中">
                        <Spin size="small" />
                    </div>
                ))}
                {!full ? (
                    <>
                        <button type="button" className="es-upload-btn" aria-label={`上传${label}`} onClick={() => input.current?.click()}>
                            <Plus size={18} strokeWidth={1.75} />
                        </button>
                        <button type="button" className="es-upload-btn" aria-label={`从素材库选择${label}`} onClick={() => setPicking(true)}>
                            <Images size={16} strokeWidth={1.75} />
                            <span>素材库</span>
                        </button>
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
                    onFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                }}
            />
            {picking ? (
                <Suspense fallback={null}>
                    <WorkbenchAssetPicker open accept={["image"]} maxCount={Math.max(1, LIMITS[kind] - items.length - pending)} slotName={label} onClose={() => setPicking(false)} onPick={onAssets} />
                </Suspense>
            ) : null}
        </section>
    );
}
