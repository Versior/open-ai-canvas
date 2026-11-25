import { App, Button, Skeleton } from "antd";
import { RotateCw, Shirt, Clapperboard } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { createCreativeJob } from "@/lib/remake/creative";
import { createProductVideo } from "@/pages/video-replication/replace/use-product-video-store";
import { remakeProductFromStudio } from "@/pages/video-replication/remake/remake-product-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/base/segmented-control";
import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { studioDisplayName } from "@/lib/ecommerce-studio/brief";
import { studioImageSetupBlock } from "@/lib/ecommerce-studio/generation-input";
import { studioPlanInputSignature } from "@/lib/ecommerce-studio/plan-input";
import { studioPlanScopeOf } from "@/lib/ecommerce-studio/runs";
import { loadStudioPromptConfig } from "./studio-prompt-config";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import type { StudioOutput, StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import type { StudioDesignCheck } from "@/lib/ecommerce-studio/design-check";
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
import { useRequireLogin } from "@/hooks/use-require-login";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

const newProductId = () => `p_${nanoid(12)}`;
const MAX_REFERENCES = 3;
type StudioStage = "form" | "plan" | "results";
const desktopViews: SegmentedOption<Exclude<StudioStage, "form">>[] = [
    { value: "plan", label: "页面设计" },
    { value: "results", label: "生成记录" },
];
const mobileViews: SegmentedOption<StudioStage>[] = [{ value: "form", label: "商品与设置" }, ...desktopViews];

function studioPendingPlanView(product?: StudioProduct) {
    const receipt = product?.planReceipt;
    if (product && receipt?.state === "submitted" && receipt.taskId && receipt.scope === studioPlanScopeOf(product) && receipt.inputSignature === studioPlanInputSignature(product)) return "plan";
}

function studioSelection(params: URLSearchParams, productId?: string | null, view?: StudioStage) {
    const next = new URLSearchParams(params);
    if (productId) next.set("product", productId);
    else next.delete("product");
    if (view) next.set("view", view);
    else next.delete("view");
    return next;
}

/**
 * 电商生图台：商品与视图由 URL 记录，刷新和回退都能回到原处。
 * 新建的商品先只在本页，第一次加图或填写时才写到服务器，不留下空商品。
 */
export default function EcommerceStudioPage() {
    const requireLogin = useRequireLogin();
    const userId = useUserStore((state) => state.user?.id);
    const { message } = App.useApp();
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const [openingVideo, setOpeningVideo] = useState(false);
    const requested = params.get("product") || "";
    const requestedView = params.get("view");
    const explicitView = requestedView === "form" || requestedView === "plan" || requestedView === "results" ? requestedView : undefined;
    const status = useStudioStore((state) => state.status);
    const error = useStudioStore((state) => state.error);
    const load = useStudioStore((state) => state.load);
    const products = useStudioStore((state) => state.products);
    const upsert = useStudioStore((state) => state.upsert);
    const update = useStudioStore((state) => state.update);
    const [draft, setDraft] = useState(() => createStudioProduct(newProductId()));
    const [viewer, setViewer] = useState<StudioViewerTarget>();
    const [fashionOpen, setFashionOpen] = useState(false);
    const runner = useStudioRunner();
    const { resume } = runner;
    const image = useStudioModel("image");
    const resumed = useRef("");

    useEffect(() => {
        if (!userId) return;
        void load();
        resumed.current = "";
        setViewer(undefined);
    }, [load, userId]);

    // 后台改过的出图提示词：读不到时按内置写法出图，并告诉用户这一次没用上后台的写法。
    useEffect(() => {
        if (!userId) return;
        const controller = new AbortController();
        void loadStudioPromptConfig(controller.signal).catch((failure) => {
            if (!controller.signal.aborted) {
                message.warning(`后台的出图提示词没有读到，这次按内置写法出图：${failure instanceof Error ? failure.message : "请稍后刷新"}`);
            }
        });
        return () => controller.abort();
    }, [message, userId]);

    const ready = !userId || status === "ready";
    const stored = userId ? products.find((item) => item.id === requested) || (!requested ? products[0] : undefined) : undefined;
    const product = stored || (!requested || requested === draft.id ? draft : undefined);
    const productId = product?.id;
    const view = explicitView ?? studioPendingPlanView(stored);
    const tab = view ?? "form";
    const activeRoute = useRef<{ productId: string | undefined; params: URLSearchParams } | undefined>(undefined);

    useLayoutEffect(() => {
        activeRoute.current = { productId, params };
        return () => {
            activeRoute.current = undefined;
        };
    }, [params, productId]);

    const setTab = (next: StudioStage) => {
        const current = activeRoute.current;
        if (!current || current.productId !== productId || current.params.get("view") === next) return;
        setParams(studioSelection(current.params, current.params.get("product") || stored?.id, next), { replace: true });
    };

    // 地址里没写商品时钉住当前这个，免得别的商品更新后排到最前、页面跟着跳。
    useEffect(() => {
        if (!userId || !ready) return;
        if (requested && !stored && requested !== draft.id) {
            message.warning("这个商品不存在或已被删除");
            setParams(studioSelection(params, products[0]?.id, explicitView ?? studioPendingPlanView(products[0])), { replace: true });
        } else if (stored && (!requested || (!explicitView && view === "plan"))) {
            setParams(studioSelection(params, stored.id, view), { replace: true });
        }
    }, [draft.id, explicitView, message, params, products, ready, requested, setParams, stored, userId, view]);

    useEffect(() => {
        if (!stored || resumed.current === stored.id) return;
        resumed.current = stored.id;
        resume(stored);
    }, [resume, stored]);

    useStudioAgentBridge(stored ? stored.id : "", product ? studioDisplayName(product) : "");

    const ensure = useCallback(() => {
        if (!product) throw new Error("商品还没有加载出来");
        if (!useStudioStore.getState().products.some((item) => item.id === product.id)) upsert(product, { immediate: true });
        return product.id;
    }, [product, upsert]);

    const edit = useCallback<Edit>(
        (updater, options) => {
            if (!userId) {
                setDraft(updater);
                return;
            }
            const id = ensure();
            update(id, updater, options);
        },
        [ensure, update, userId],
    );

    const create = () => {
        const next = createStudioProduct(newProductId());
        setDraft(next);
        setParams(studioSelection(params, next.id, "form"));
        setViewer(undefined);
    };

    const groups = useMemo(() => (product ? studioShotGroups(product) : []), [product]);

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
    const tune = async (group: StudioShotGroup, shot: StudioShot, patch: StudioShotPatch, revisionResourceId?: string) => {
        if (!requireLogin()) return;
        if (!product) return;
        const blocked = studioImageSetupBlock(group.source ?? product, image.value);
        if (blocked) return void message.warning(blocked);
        try {
            edit((current) => patchStudioShotAt(current, group.ref, shot.id, (value) => ({ ...value, ...patch })), { immediate: true });
            if (!(await runner.rerun(product.id, group.ref, [shot.id], image.value, revisionResourceId))) message.info("这张图正在生成，等它完成");
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : "提交失败");
        }
    };

    const openProductVideo = async () => {
        if (!requireLogin() || openingVideo) return;
        setOpeningVideo(true);
        try {
            const id = ensure();
            await useStudioStore.getState().flush(id);
            const saved = useStudioStore.getState().products.find((item) => item.id === id);
            if (!saved) throw new Error("商品未保存");
            const video = createCreativeJob(nanoid(12), remakeProductFromStudio(saved));
            await createProductVideo(video);
            navigate(`/video-replication?remake=${encodeURIComponent(video.id)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建商品视频失败");
        } finally {
            setOpeningVideo(false);
        }
    };

    const loading = !product && (status === "idle" || status === "loading");

    return (
        <WorkspacePage fluid scroll={false} className="es-page">
            <div className="es-shell" data-tab={tab}>
                {userId && status === "error" && !products.length ? (
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
                                if (id === product.id) return;
                                setParams(studioSelection(params, id, studioPendingPlanView(products.find((item) => item.id === id)) ?? tab));
                                setViewer(undefined);
                            }}
                            onCreate={create}
                            onDeleted={() => setParams(studioSelection(params), { replace: true })}
                            tools={[
                                {
                                    key: "video",
                                    icon: <Clapperboard size={15} aria-hidden />,
                                    label: openingVideo ? "打开商品视频策划中…" : "商品视频策划",
                                    disabled: openingVideo || (Boolean(userId) && !product.photos.length),
                                    onClick: () => void openProductVideo(),
                                },
                                { key: "fashion", icon: <Shirt size={15} aria-hidden />, label: "换装 · 换脸 · 印花", onClick: () => setFashionOpen(true) },
                            ]}
                        >
                            <SegmentedControl<Exclude<StudioStage, "form">> block className="es-tabs es-tabs-desktop" ariaLabel="右侧工作区" value={tab === "results" ? "results" : "plan"} onChange={setTab} options={desktopViews} />
                            <SegmentedControl<StudioStage> block className="es-tabs es-tabs-mobile" ariaLabel="电商生图台工作阶段" value={tab} onChange={setTab} options={mobileViews} />
                        </StudioHeader>
                        <div className="es-body">
                            <StudioForm
                                key={product.id}
                                product={product}
                                edit={edit}
                                ensure={ensure}
                                runner={runner}
                                onOutputChange={() => {
                                    if (tab === "results") setTab("plan");
                                }}
                                onPlanning={() => setTab("plan")}
                                onGenerated={() => setTab("results")}
                            />
                            <StudioResults product={product} edit={edit} runner={runner} imageModel={image.value} onView={setViewer} onReference={addReference} />
                        </div>
                    </>
                )}
            </div>
            <StudioViewer
                product={product}
                groups={groups}
                target={viewer}
                imageModel={image.value}
                onChange={setViewer}
                onClose={() => setViewer(undefined)}
                onDownload={download}
                onReference={addReference}
                onTune={tune}
                onApplyCopy={(group, shot, patch) =>
                    edit((current) => patchStudioShotAt(current, group.ref, shot.id, (value) => ({ ...value, headline: patch.headline, subline: patch.subline, lines: patch.lines, copySource: "user" })), { immediate: true })
                }
                onAdopt={(group, shot, output) => edit((current) => patchStudioShotAt(current, group.ref, shot.id, (value) => ({ ...value, adopted: output })), { immediate: true })}
                onReview={(group, shot, output, result: StudioDesignCheck) =>
                    edit(
                        (current) =>
                            patchStudioShotAt(current, group.ref, shot.id, (value) => ({
                                ...value,
                                attempts: value.attempts.map((attempt) =>
                                    attempt.outputs.some((item) => item.resourceId === output.resourceId)
                                        ? {
                                              ...attempt,
                                              visualReview: {
                                                  status: result.findings.some((finding) => finding.status === "fail") ? "failed" : result.findings.some((finding) => finding.status === "unknown") ? "unknown" : "passed",
                                                  findings: result.findings,
                                                  revision: result.revision || undefined,
                                                  checkedAt: new Date().toISOString(),
                                              },
                                          }
                                        : attempt,
                                ),
                            })),
                        { immediate: true },
                    )
                }
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
