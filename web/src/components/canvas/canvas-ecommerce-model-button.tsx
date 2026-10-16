import { useEffect, useState } from "react";
import { UserRound, X } from "lucide-react";

import { CanvasEcommerceModelLibraryModal } from "./canvas-ecommerce-model-library";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import { ecommerceModelById, ecommerceModelRefCount, type EcommerceModel } from "@/lib/ecommerce/ecommerce-models";
import { useEcommerceModelLibrary } from "@/stores/use-ecommerce-model-library";

/**
 * 输入框上的模特按钮——电商画布里它取代了原来的「风格」。
 *
 * 为什么这个位置该给模特而不是风格：
 *
 * 自由画布点那颗按钮想的是「这张图看起来像什么流派」（赛博朋克、水墨）。
 * 电商画布点它想的是**「这张图上的人是谁」**——同一款衣服九屏详情页，
 * 人不能变。风格在电商里是品牌的属性（挂在品牌风格节点上，跨整组统一），
 * 而模特是每一张图都要点名的人，它属于「这一张」这个层级。
 *
 * 选中后写进节点 metadata，由编译器的模特锁定块进提示词，
 * 模特自己的参考图也会一起送进去——图才是「同一个人」的依据。
 */
export function CanvasEcommerceModelButton({
    modelId,
    onSelect,
    onClear,
}: {
    modelId?: string;
    onSelect: (model: EcommerceModel) => void;
    onClear: () => void;
}) {
    const [open, setOpen] = useState(false);
    const models = useEcommerceModelLibrary((state) => state.models);
    const hydrate = useEcommerceModelLibrary((state) => state.hydrate);
    const touchModel = useEcommerceModelLibrary((state) => state.touchModel);
    const { generateEcommerceModelPreset } = useCanvasNodeActions();

    useEffect(() => {
        void hydrate();
    }, [hydrate]);

    const active = ecommerceModelById(modelId, models);
    const refs = ecommerceModelRefCount(active);

    return (
        <>
            <div
                role="button"
                tabIndex={0}
                className="canvas-node-composer-header-action canvas-node-fixed-chip relative cursor-pointer overflow-hidden"
                title={active ? `模特：${active.name}${refs ? `（${refs} 张参考图）` : ""}` : "选择模特——这张图上的人是谁"}
                aria-expanded={open}
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <UserRound className="size-3 shrink-0" />
                <span className="truncate">{active?.name || "模特"}</span>
                {active ? (
                    <button
                        type="button"
                        aria-label="移除模特"
                        onClick={(event) => {
                            event.stopPropagation();
                            onClear();
                        }}
                    >
                        <X className="size-3" />
                    </button>
                ) : null}
            </div>
            <CanvasEcommerceModelLibraryModal
                open={open}
                activeModelId={modelId}
                onClose={() => setOpen(false)}
                onGeneratePreset={generateEcommerceModelPreset}
                onSelect={(model) => {
                    touchModel(model.id);
                    onSelect(model);
                }}
            />
        </>
    );
}
