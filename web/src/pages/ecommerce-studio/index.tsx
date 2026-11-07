import { App, Button, Skeleton } from "antd";
import { RotateCw, Shirt } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { studioDisplayName } from "@/lib/ecommerce-studio/brief";
import { studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { setStudioPromptOverrides } from "@/lib/ecommerce-studio/prompt-overrides";
import { getStudioPrompts } from "@/services/api/ecommerce-studio";
import { createStudioProduct, studioOutputCount } from "@/lib/ecommerce-studio/product";
import type { StudioOutput, StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceStorageKey } from "@/services/api/resources";
import { StudioForm } from "./studio-form";
import { StudioHeader } from "./studio-header";
import { useStudioModel } from "./studio-parts";
import { StudioResults, studioShotGroups, type StudioShotGroup, type StudioViewerTarget } from "./studio-results";
import type { StudioShotPatch } from "./studio-shot-tuner";
import { StudioViewer } from "./studio-viewer";
import { useStudioAgentBridge } from "./use-studio-agent";
import { patchStudioShotAt, useStudioRunner } from "./use-studio-runner";
import { useStudioStore } from "./use-studio-store";
import "./studio.css";
import { FashionWorkbench } from "@/components/fashion/fashion-workbench";
import { useUserStore } from "@/stores/use-user-store";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

const newProductId = () => `p_${nanoid(12)}`;
const MAX_REFERENCES = 3;

/**
 * 电商生图台：左边填表，右边看生成记录。当前商品写在 ?product= 里，刷新和回退都能回到原处。
 * 新建的商品先只在本页，第一次加图或填写时才写到服务器，不留下空商品。
 */
export default function EcommerceStudioPage() {
    const userId = useUserStore((state) => state.user?.id);
    const { message } = App.useApp();
    const [params, setParams] = useSearchParams();
    const requested = params.get("product") || "";
    const status = useStudioStore((state) => state.status);
    const error = useStudioStore((state) => state.error);
    const load = useStudioStore((state) => state.load);
    const products = useStudioStore((state) => state.products);
    const upsert = useStudioStore((state) => state.upsert);
    const update = useStudioStore((state) => state.update);
    const [draft, setDraft] = useState(() => createStudioProduct(newProductId()));
    const [tab, setTab] = useState<"form" | "results">("form");
    const [viewer, setViewer] = useState<StudioViewerTarget>();
    const [fashionOpen, setFashionOpen] = useState(false);
    const runner = useStudioRunner();
    const { resume } = runner;
    const image = useStudioModel("image");
    const resumed = useRef("");

    useEffect(() => {
        void load();
        resumed.current = "";
        setViewer(undefined);
    }, [load, userId]);

    // 后台改过的出图提示词：读不到时按内置写法出图，并告诉用户这一次没用上后台的写法。
    useEffect(() => {
        const controller = new AbortController();
        void getStudioPrompts(controller.signal)
            .then(setStudioPromptOverrides)
            .catch((failure) => {
                if (!controller.signal.aborted) message.warning(`后台的出图提示词没有读到，这次按内置写法出图：${failure instanceof Error ? failure.message : "请稍后刷新"}`);
            });
        return () => controller.abort();
    }, [message]);

    const ready = status === "ready";
    const stored = products.find((item) => item.id === requested) || (!requested ? products[0] : undefined);
    const product = stored || (!requested || requested === draft.id ? draft : undefined);

    // 地址里没写商品时钉住当前这个，免得别的商品更新后排到最前、页面跟着跳。
    useEffect(() => {
        if (!ready) return;
        if (!requested && stored) setParams({ product: stored.id }, { replace: true });
        else if (requested && !stored && requested !== draft.id) {
            message.warning("这个商品不存在或已被删除");
            setParams(products[0] ? { product: products[0].id } : {}, { replace: true });
        }
    }, [draft.id, message, products, ready, requested, setParams, stored]);

    useEffect(() => {
        if (!stored || resumed.current === stored.id) return;
        resumed.current = stored.id;
        resume(stored);
    }, [resume, stored]);

    useStudioAgentBridge(stored ? stored.id : "", product ? studioDisplayName(product) : "");

    const ensure = useCallback(() => {
        if (!product) throw new Error("商品还没有加载出来");
        if (!useStudioStore.getState().products.some((item) => item.id === product.id)) {
            upsert(product, { immediate: true });
            setParams({ product: product.id }, { replace: true });
        }
        return product.id;
    }, [product, setParams, upsert]);

    const edit = useCallback<Edit>(
        (updater, options) => {
            const id = ensure();
            update(id, updater, options);
        },
        [ensure, update],
    );

    const create = () => {
        const next = createStudioProduct(newProductId());
        setDraft(next);
        setParams({ product: next.id });
        setTab("form");
        setViewer(undefined);
    };

    const groups = useMemo(() => (product ? studioShotGroups(product) : []), [product]);
    const blocked = !product?.photos.length ? "先上传商品图" : !studioReferencePhotos(product.photos).length ? "至少点亮一张商品图的星标，出图以它为外观依据" : !image.value ? "先选择图片模型" : "";

    const addReference = (output: StudioOutput) => {
        if (!product) return;
        if (product.references.some((item) => item.resourceId === output.resourceId)) return void message.info("这张图已经在参考图里");
        if (product.references.length >= MAX_REFERENCES) return void message.warning(`参考图最多 ${MAX_REFERENCES} 张，先移除一张`);
        const photo = {
            id: nanoid(10),
            resourceId: output.resourceId,
            url: output.url,
            view: "other" as const,
            truth: false,
            name: "生成结果",
            ...(output.width ? { width: output.width } : {}),
            ...(output.height ? { height: output.height } : {}),
            addedAt: new Date().toISOString(),
        };
        edit((current) => (current.references.some((item) => item.resourceId === output.resourceId) || current.references.length >= MAX_REFERENCES ? current : { ...current, references: [...current.references, photo] }), { immediate: true });
        message.success("已加入参考图，可以勾选「一键同款参考图版式」照着它出图");
        setViewer(undefined);
        setTab("form");
    };

    const download = (shot: StudioShot, output: StudioOutput) => {
        if (!product) return;
        const fileName = `${studioDisplayName(product)}-${shot.title || "商品图"}.png`.replace(/[\\/:*?"<>|]+/g, "_");
        void downloadBrowserMedia({ fileName, storageKey: resourceStorageKey(output.resourceId) }).catch((failure) => message.error(failure instanceof Error ? failure.message : "下载失败"));
    };

    /** 大图里调整这一张：先把微调和文案写回这张镜头，再按它出一张新的；之前的结果都保留。 */
    const tune = (group: StudioShotGroup, shot: StudioShot, patch: StudioShotPatch, revisionResourceId?: string) => {
        if (!product) return;
        if (blocked) return void message.warning(blocked);
        try {
            edit((current) => patchStudioShotAt(current, group.ref, shot.id, (value) => ({ ...value, ...patch })), { immediate: true });
            if (!runner.rerun(product.id, group.ref, [shot.id], image.value, revisionResourceId)) message.info("这张图正在生成，等它完成");
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : "提交失败");
        }
    };

    const outputs = product ? studioOutputCount(product) : 0;
    const loading = !product && (status === "idle" || status === "loading");

    return (
        <WorkspacePage fluid scroll={false} className="es-page">
            <div className="es-shell" data-tab={tab}>
                {status === "error" && !products.length ? (
                    <div className="es-center">
                        <EmptyState
                            title="生图台没有加载出来"
                            description={error}
                            action={
                                <Button icon={<RotateCw size={14} />} onClick={() => void load(true)}>
                                    重新加载
                                </Button>
                            }
                        />
                    </div>
                ) : !product || (!ready && !stored) ? (
                    <div className="es-center">{loading || !ready ? <Skeleton active paragraph={{ rows: 8 }} /> : null}</div>
                ) : (
                    <>
                        <StudioHeader
                            product={product}
                            saved={Boolean(stored)}
                            onSwitch={(id) => {
                                setParams({ product: id });
                                setViewer(undefined);
                            }}
                            onCreate={create}
                            onDeleted={() => setParams({}, { replace: true })}
                        />
                        <div className="es-tabs">
                            <Button icon={<Shirt size={15} />} onClick={() => setFashionOpen(true)}>
                                换装 · 换脸 · 印花
                            </Button>
                            <SegmentedControl<"form" | "results">
                                block
                                ariaLabel="切换生图表单与生成记录"
                                value={tab}
                                onChange={setTab}
                                options={[
                                    { value: "form", label: "生图" },
                                    { value: "results", label: outputs ? `生成记录 ${outputs}` : "生成记录" },
                                ]}
                            />
                        </div>
                        <div className="es-body">
                            <StudioForm key={product.id} product={product} edit={edit} ensure={ensure} runner={runner} onGenerated={() => setTab("results")} />
                            <StudioResults product={product} edit={edit} runner={runner} imageModel={image.value} blocked={blocked} onView={setViewer} onReference={addReference} />
                        </div>
                    </>
                )}
            </div>
            <StudioViewer
                product={product}
                groups={groups}
                target={viewer}
                blocked={blocked}
                imageModel={image.value}
                onChange={setViewer}
                onClose={() => setViewer(undefined)}
                onDownload={download}
                onReference={addReference}
                onTune={tune}
                onApplyCopy={(group, shot, patch) => edit((current) => patchStudioShotAt(current, group.ref, shot.id, (value) => ({ ...value, headline: patch.headline, subline: patch.subline, lines: patch.lines })), { immediate: true })}
                onAdopt={(group, shot, output) => edit((current) => patchStudioShotAt(current, group.ref, shot.id, (value) => ({ ...value, adopted: output })), { immediate: true })}
            />
            {fashionOpen ? (
                <FashionWorkbench
                    onClose={() => setFashionOpen(false)}
                    onUse={(image) => {
                        edit(
                            (value) => ({
                                ...value,
                                references: [...value.references.slice(0, MAX_REFERENCES - 1), { ...image, url: `/api/resources/${image.resourceId}/file`, id: nanoid(10), view: "other", truth: false, addedAt: new Date().toISOString() }],
                            }),
                            { immediate: true },
                        );
                        message.success("已加入生图参考素材，请确认用途后生成");
                        setFashionOpen(false);
                    }}
                />
            ) : null}
        </WorkspacePage>
    );
}
