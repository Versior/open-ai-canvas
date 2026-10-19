import { App } from "antd";
import { ArrowUpRight, Image as ImageIcon, Plus, Replace, Unplug, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useNodeConnections, useNodeInputs } from "@/components/canvas/canvas-node-graph-context";
import { CanvasEcommerceModelLibraryModal } from "@/components/canvas/canvas-ecommerce-model-library";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { createEcommerceProductProfile, ECOMMERCE_PRODUCT_VIEWS } from "@/lib/ecommerce/ecommerce-contract";
import { connectedStyleReferenceNodes, effectiveProductViews } from "@/lib/ecommerce/ecommerce-canvas";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "@/lib/ecommerce/ecommerce-oneclick";
import { stopCanvasDragFromInteractive } from "@/lib/canvas/node-interaction";
import { ecommerceModelById, ecommerceModelRefCount } from "@/lib/ecommerce/ecommerce-models";
import { useEcommerceModelLibrary } from "@/stores/use-ecommerce-model-library";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

export function ProductNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const actions = useCanvasNodeActions();
    const setting = useEcommerceSettings((state) => state.setting);
    const { updateMetadata, upload } = actions;
    const inputs = useNodeInputs(node.id);
    const connections = useNodeConnections(node.id);
    const { message } = App.useApp();
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const models = useEcommerceModelLibrary((state) => state.models);
    const hydrateModels = useEcommerceModelLibrary((state) => state.hydrate);
    const touchModel = useEcommerceModelLibrary((state) => state.touchModel);
    useEffect(() => {
        void hydrateModels().catch((error) => message.error(error instanceof Error ? error.message : "加载失败"));
    }, [hydrateModels, message]);

    const profile = node.metadata?.productProfile || createEcommerceProductProfile(node.title || "商品");
    const views = effectiveProductViews(profile, inputs, connections, node.id);
    const inputById = new Map(inputs.map((item) => [item.id, item]));
    const referenceIds = new Set(connectedStyleReferenceNodes(node.id, inputs, connections).map((item) => item.id));
    connections.filter((edge) => edge.toNodeId === node.id && edge.toHandleId?.startsWith("visual-reference:")).forEach((edge) => referenceIds.add(edge.fromNodeId));
    const references = inputs.filter((item) => referenceIds.has(item.id));
    const productImages = inputs.filter((item) => item.type === CanvasNodeType.Image && !referenceIds.has(item.id) && (item.metadata?.content || item.metadata?.storageKey));
    const editable = Boolean(updateMetadata);
    const model = ecommerceModelById(node.metadata?.ecommerceModelId, models);
    const openSuite = (flow: typeof ECOMMERCE_ONE_CLICK_FLOWS[number]["id"]) => {
        if (!setting.enabled || !setting.flows[flow].enabled) { message.warning("管理员已停用此创作用途"); return; }
        actions.openEcommerceTable?.(node, flow);
    };
    const addInput = (handle: string) => actions.addEcommerceInput?.(node, handle);
    const referenceEdges = connections.filter((edge) => edge.toNodeId === node.id && referenceIds.has(edge.fromNodeId));
    const referenceHandles = new Set(connections.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.toHandleId));
    const referenceSlots = references.map((image) => {
        const edge = referenceEdges.find((item) => item.fromNodeId === image.id && item.toHandleId?.startsWith("visual-reference:"));
        let handle = edge?.toHandleId;
        if (!handle) {
            let index = 0;
            while (referenceHandles.has(`visual-reference:${index}`)) index += 1;
            handle = `visual-reference:${index}`;
            referenceHandles.add(handle);
        }
        return { image, handle };
    });
    let nextReference = 0;
    while (referenceHandles.has(`visual-reference:${nextReference}`)) nextReference += 1;

    return (
        <div className="ecom-card ecom-product-card" style={{ color: theme.node.text }} onMouseDown={stopCanvasDragFromInteractive}>
            <header className="ecom-card-header"><EcommerceNodeTitle node={node} fallback="商品" /><span className="ecom-card-status">{productImages.length} 张商品图</span></header>
            {node.metadata?.ecommerceOneClick && editable ? <div className="ecom-input-section" role="status">
                <p>{node.metadata.ecommerceOneClick.status === "failed" ? `自动装订失败：${node.metadata.ecommerceOneClick.error || "请重试"}` : "等待本轮图片完成后自动装订"}</p>
                {node.metadata.ecommerceOneClick.status === "failed" ? <button type="button" className="ecom-action" onClick={() => updateMetadata?.(node.id, { ecommerceOneClick: { ...node.metadata!.ecommerceOneClick!, status: "running", error: undefined } })}>重试装订（不重新生图）</button> : null}
                <button type="button" className="ecom-action" onClick={() => updateMetadata?.(node.id, { ecommerceOneClick: undefined })}>取消自动装订</button>
            </div> : null}
            <section className="ecom-input-section" aria-label="商品视图">
                <h4>商品视图</h4>
                <div className="ecom-input-grid">
                    {ECOMMERCE_PRODUCT_VIEWS.map((view) => <ProductInputSlot key={view.id} product={node} handle={`product-view:${view.id}`} label={view.label} image={inputById.get(views[view.id] || "")} editable={editable} onAdd={() => addInput(`product-view:${view.id}`)} />)}
                </div>
            </section>
            <section className="ecom-input-section" aria-label="参考图">
                <h4>参考图 <span>{references.length}</span></h4>
                <div className="ecom-input-grid ecom-reference-grid">
                    {referenceSlots.map(({ image, handle }, index) => {
                        return <ProductInputSlot key={image.id} product={node} handle={handle} label={`参考 ${index + 1}`} image={image} editable={editable} onAdd={() => upload?.(image)} />;
                    })}
                    <ProductInputSlot product={node} handle={`visual-reference:${nextReference}`} label="添加参考" editable={editable} onAdd={() => addInput(`visual-reference:${nextReference}`)} />
                </div>
            </section>
            <div className="ecom-product-model-row">
                <button type="button" className="ecom-model-pick" disabled={!editable || !setting.modelLibraryEnabled} onClick={() => setModelPickerOpen(true)}><UserRound className="size-4" /><span className="truncate">{model?.name || "选择模特"}</span>{model ? <span className="ecom-model-pick-hint">{ecommerceModelRefCount(model)} 张参考图</span> : null}</button>
                {node.metadata?.ecommerceModelId && editable ? <button type="button" className="ecom-input-icon" title="取消模特" aria-label="取消模特" onClick={() => updateMetadata?.(node.id, { ecommerceModelId: undefined })}><X className="size-4" /></button> : null}
            </div>
            <div className="ecom-oneclick-row">
                {ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => {
                    return <button key={flow.id} type="button" className="ecom-oneclick" disabled={!editable || !setting.enabled || !setting.flows[flow.id].enabled || !actions.openEcommerceTable} onClick={() => openSuite(flow.id)}><span className="ecom-oneclick-name">{flow.name.replace(/^一键/, "")}</span><ArrowUpRight className="size-3.5" aria-hidden="true" /></button>;
                })}
            </div>
            <CanvasEcommerceModelLibraryModal open={modelPickerOpen} activeModelId={node.metadata?.ecommerceModelId} onClose={() => setModelPickerOpen(false)} onSelect={async (model) => { await touchModel(model.id); updateMetadata?.(node.id, { ecommerceModelId: model.id }); }} />
        </div>
    );
}

function ProductInputSlot({ product, handle, label, image, editable, onAdd }: { product: CanvasNodeData; handle: string; label: string; image?: CanvasNodeData; editable: boolean; onAdd: () => void }) {
    const actions = useCanvasNodeActions();
    const slotRef = useRef<HTMLDivElement>(null);
    const pinRef = useRef<HTMLButtonElement>(null);
    const lastAnchor = useRef<{ handle: string; y: number; x: number } | null>(null);
    const updateAnchor = actions.updateEcommerceInputAnchor;
    const content = image?.metadata?.content || "";
    const storageKey = image?.metadata?.storageKey;
    const imageKey = `${image?.id || ""}:${storageKey || ""}:${content}`;
    const [resolved, setResolved] = useState({ key: imageKey, url: content });
    const src = resolved.key === imageKey ? resolved.url : content;
    const hasImage = Boolean(content || storageKey);
    useEffect(() => {
        let cancelled = false;
        if (storageKey) {
            void resolveImageUrl(storageKey, content)
                .then((url) => { if (!cancelled) setResolved({ key: imageKey, url }); })
                .catch(() => { if (!cancelled) setResolved({ key: imageKey, url: "" }); });
        }
        return () => { cancelled = true; };
    }, [content, imageKey, storageKey]);
    useEffect(() => {
        const slot = slotRef.current;
        const pin = pinRef.current;
        const wrapper = slot?.closest<HTMLElement>("[data-node-id]");
        if (!editable || !updateAnchor || !slot || !pin || !wrapper) return;
        lastAnchor.current = null;
        let frame = 0;
        const measure = () => {
            frame = 0;
            const nodeRect = wrapper.getBoundingClientRect();
            const pinRect = pin.getBoundingClientRect();
            if (!nodeRect.width || !nodeRect.height) return;
            const y = Math.min(1, Math.max(0, (pinRect.top + pinRect.height / 2 - nodeRect.top) / nodeRect.height));
            const x = Math.min(1, Math.max(0, (pinRect.left + pinRect.width / 2 - nodeRect.left) / nodeRect.width));
            const previous = lastAnchor.current;
            if (previous?.handle === handle && Math.abs(previous.y - y) < 0.0001 && Math.abs(previous.x - x) < 0.0001) return;
            lastAnchor.current = { handle, y, x };
            updateAnchor(product.id, handle, y, x);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
        const observer = new ResizeObserver(schedule);
        observer.observe(wrapper);
        observer.observe(slot);
        observer.observe(pin);
        wrapper.addEventListener("scroll", schedule, true);
        schedule();
        return () => {
            observer.disconnect();
            wrapper.removeEventListener("scroll", schedule, true);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [editable, handle, image?.id, product.id, updateAnchor]);
    return (
        <div ref={slotRef} className="ecom-input-slot" data-filled={hasImage || undefined} data-ecommerce-input={editable ? handle : undefined} data-product-node-id={product.id} onPointerUp={(event) => { if (editable) actions.dropEcommerceInput?.(event, product.id, handle); }}>
            <button type="button" className="ecom-input-preview" title={hasImage ? `查看${label}` : `上传${label}`} aria-label={hasImage ? `查看${label}` : `上传${label}`} disabled={!hasImage && !editable} onClick={() => image && hasImage ? actions.viewImage?.(image) : editable ? image ? actions.upload?.(image) : onAdd() : undefined}>
                {src ? <img src={src} alt={label} draggable={false} loading="lazy" onError={() => setResolved({ key: imageKey, url: "" })} /> : <ImageIcon className="size-5" />}
            </button>
            <span className="ecom-input-label">{label}</span>
            {editable ? <button ref={pinRef} type="button" className="ecom-input-pin" title={`连接到${label}`} aria-label={`连接到${label}`} onPointerDown={(event) => { if (event.button === 0) actions.connectEcommerceInput?.(event, product.id, handle); }}><Plus className="size-3" /></button> : null}
            <div className="ecom-input-tools">
                {image && editable ? <><button type="button" className="ecom-input-icon" title="替换图片" aria-label={`替换${label}`} onClick={() => actions.upload?.(image)}><Replace className="size-3" /></button><button type="button" className="ecom-input-icon" title="断开连接" aria-label={`断开${label}`} onClick={() => actions.disconnectEcommerceInput?.(product.id, handle, image.id)}><Unplug className="size-3" /></button></> : null}
            </div>
        </div>
    );
}
