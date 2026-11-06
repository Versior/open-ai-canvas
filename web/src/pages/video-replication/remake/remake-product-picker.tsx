import { Button, Spin } from "antd";
import { Package } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/product/empty-state";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";
import type { RemakeProduct } from "@/lib/remake/job";
import { getStudioWorkspace } from "@/services/api/ecommerce-studio";
import { productVideoThumbUrl } from "../replace/product-video-assets";

/** 生图台商品换成复刻用的商品：名称、开启的卖点、外观依据照片在前（最多 4 张）。 */
export function remakeProductFromStudio(product: StudioProduct): RemakeProduct {
    const photos = [...product.photos].filter((photo) => photo.view !== "tag").sort((a, b) => Number(b.truth) - Number(a.truth));
    const points = product.sellingPoints.filter((point) => point.enabled).map((point) => [point.title, point.detail].filter(Boolean).join("："));
    return {
        studioProductId: product.id,
        name: product.dossier?.name || product.name,
        sellingPoints: points.join("\n").slice(0, 400),
        images: photos.slice(0, 4).map((photo) => ({ id: photo.id, resourceId: photo.resourceId, name: photo.name || product.name, width: photo.width, height: photo.height })),
    };
}

/** 从电商生图台选一件商品：照片和档案一起带过来，不用重填。 */
export function RemakeProductPicker({ onClose, onPick }: { onClose: () => void; onPick: (product: RemakeProduct) => void }) {
    const [products, setProducts] = useState<StudioProduct[]>();
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let alive = true;
        setError("");
        getStudioWorkspace()
            .then((value) => alive && setProducts(value.products.filter((item) => item.photos.length)))
            .catch((failure) => alive && setError(failure instanceof Error ? failure.message : "读取生图台商品失败"));
        return () => {
            alive = false;
        };
    }, [retry]);
    return (
        <AppModal open onCancel={onClose} footer={null} width={760} centered title="从电商生图台选商品">
            <div className="rw-picker">
                {error ? (
                    <EmptyState size="compact" title="读取失败" description={error} action={<Button onClick={() => setRetry((value) => value + 1)}>重试</Button>} />
                ) : !products ? (
                    <div className="rw-picker-loading">
                        <Spin size="small" /> 正在读取生图台商品…
                    </div>
                ) : !products.length ? (
                    <EmptyState size="compact" icon={Package} title="生图台里还没有带照片的商品" description="先去电商生图台建商品、上传照片，或者在这里直接上传商品图。" />
                ) : (
                    <div className="rw-picker-grid">
                        {products.map((product) => {
                            const value = remakeProductFromStudio(product);
                            const cover = value.images[0];
                            return (
                                <button key={product.id} type="button" className="rw-picker-item" onClick={() => onPick(value)}>
                                    <span className="rw-picker-cover">{cover ? <img src={productVideoThumbUrl(cover.resourceId)} alt="" loading="lazy" /> : <Package size={18} aria-hidden />}</span>
                                    <strong>{value.name || "未命名商品"}</strong>
                                    <span>
                                        {value.images.length} 张图{value.sellingPoints ? ` · ${value.sellingPoints.split("\n").length} 条卖点` : ""}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </AppModal>
    );
}
