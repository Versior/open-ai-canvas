import { App, Button, Input, Spin } from "antd";
import { ImageOff, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { StudioModelCast, StudioModelPick, StudioProduct } from "@/lib/ecommerce-studio/types";
import {
    attachStudioModel,
    listStudioModels,
    STUDIO_MODEL_GENDER_LABEL,
    STUDIO_MODEL_KIND_LABEL,
    studioModelImageUrl,
    studioModelPortrait,
    type StudioModelGender,
    type StudioModelItem,
    type StudioModelKind,
    type StudioModelPage,
} from "@/services/api/studio-models";
import { studioImageUrl } from "./studio-parts";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

const KINDS: StudioModelKind[] = ["face", "figure", "pose", "style"];
const PAGE_SIZE = 24;
const GENDERS: StudioModelGender[] = ["", "female", "male"];

/** 从模特库挑人脸、全身模特、姿势或造型。带图的素材选中时把原图复制到自己的资源库，出图引用自己的那份。 */
export function StudioCastPicker({ kind: initialKind, kinds = KINDS, onClose, onPick }: { kind: StudioModelKind; kinds?: StudioModelKind[]; onClose: () => void; onPick: (kind: StudioModelKind, pick: StudioModelPick) => void }) {
    const { message } = App.useApp();
    const [kind, setKind] = useState(initialKind);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const [gender, setGender] = useState<StudioModelGender>("");
    const [page, setPage] = useState(1);
    const [data, setData] = useState<StudioModelPage>();
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const [attaching, setAttaching] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        setError("");
        const timer = setTimeout(() => {
            void listStudioModels({ kind, q: query, category, gender: studioModelPortrait(kind) ? gender : "", page, pageSize: PAGE_SIZE }, controller.signal)
                .then((value) => {
                    if (!controller.signal.aborted) setData(value);
                })
                .catch((failure) => {
                    if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "模特库读取失败");
                });
        }, 200);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [kind, query, category, gender, page, retry]);

    const choose = async (item: StudioModelItem) => {
        if (attaching) return;
        if (item.kind === "style") return onPick("style", { itemId: item.id, name: item.name, prompt: item.prompt });
        setAttaching(item.id);
        try {
            const copy = await attachStudioModel(item.id);
            onPick(item.kind, { itemId: item.id, name: item.name, prompt: item.prompt, resourceId: copy.resourceId, ...(copy.width ? { width: copy.width } : {}), ...(copy.height ? { height: copy.height } : {}) });
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : "选用失败，请重试");
        } finally {
            setAttaching("");
        }
    };

    const switchKind = (next: StudioModelKind) => {
        setKind(next);
        setCategory("");
        setPage(1);
        setData(undefined);
    };
    const items = data && data.items.every((item) => item.kind === kind) ? data.items : undefined;

    return (
        <AppModal open onCancel={onClose} footer={null} width={880} centered flush rootClassName="es-portal" title={null}>
            <div className="es-suite-picker">
                <header className="es-suite-picker-head">
                    <div>
                        <h3>模特库</h3>
                        <span>人脸定长相，全身模特定整个人（和人脸二选一），姿势定动作，造型定妆发与穿搭；商品外观仍以你的商品图为准。</span>
                    </div>
                    <SegmentedControl<StudioModelKind> ariaLabel="素材类型" value={kind} onChange={switchKind} options={kinds.map((value) => ({ value, label: STUDIO_MODEL_KIND_LABEL[value] }))} />
                </header>
                <div className="es-suite-picker-body">
                    <div className="es-cast-filters">
                        <Input
                            allowClear
                            aria-label="搜索模特库"
                            placeholder="搜索名称、分类或标签"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                        />
                        {studioModelPortrait(kind) ? (
                            <div className="es-chips" role="group" aria-label="性别">
                                {GENDERS.map((value) => (
                                    <button key={value || "all"} type="button" className="es-chip" aria-pressed={gender === value} onClick={() => (setGender(value), setPage(1))}>
                                        {value ? STUDIO_MODEL_GENDER_LABEL[value] : "全部"}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {data?.categories.length ? (
                            <div className="es-chips" role="group" aria-label="分类">
                                {["", ...data.categories].map((value) => (
                                    <button key={value || "all"} type="button" className="es-chip" aria-pressed={category === value} onClick={() => (setCategory(value), setPage(1))}>
                                        {value || "全部分类"}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    {error ? (
                        <div className="es-suite-note" role="alert">
                            {error}
                            <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                                重试
                            </Button>
                        </div>
                    ) : null}
                    {!items && !error ? (
                        <div className="es-suite-note" role="status">
                            <Spin size="small" /> 正在读取模特库…
                        </div>
                    ) : null}
                    {items && !items.length ? (
                        <div className="es-empty">
                            <strong>{query || category ? "没有匹配的素材" : `模特库里还没有上架的${STUDIO_MODEL_KIND_LABEL[kind]}`}</strong>
                            <span>{query || category ? "换个关键词或分类试试。" : "管理员可以在「后台 → 电商模特库」里添加并上架。"}</span>
                        </div>
                    ) : null}
                    {items?.length ? (
                        <div className="es-cast-grid">
                            {items.map((item) => (
                                <button key={item.id} type="button" className="es-cast-option" disabled={Boolean(attaching)} onClick={() => void choose(item)} aria-label={`选用${STUDIO_MODEL_KIND_LABEL[item.kind]}：${item.name}`}>
                                    <span className="es-cast-option-image">
                                        {item.hasImage ? (
                                            <img src={studioModelImageUrl(item, true)} alt="" loading="lazy" />
                                        ) : (
                                            <span className="es-cast-option-text">
                                                <ImageOff size={14} aria-hidden />
                                                {item.prompt.slice(0, 48)}
                                            </span>
                                        )}
                                        {attaching === item.id ? (
                                            <span className="es-cast-option-busy">
                                                <Spin size="small" />
                                            </span>
                                        ) : null}
                                    </span>
                                    <strong>{item.name}</strong>
                                    <span>{[item.category, studioModelPortrait(item.kind) && item.gender ? STUDIO_MODEL_GENDER_LABEL[item.gender] : "", ...item.tags.slice(0, 2)].filter(Boolean).join(" · ") || " "}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                    {data && data.total > PAGE_SIZE ? (
                        <div className="es-cast-pages">
                            <Button size="small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                                上一页
                            </Button>
                            <span>
                                第 {page} / {Math.ceil(data.total / PAGE_SIZE)} 页 · 共 {data.total} 个
                            </span>
                            <Button size="small" disabled={page * PAGE_SIZE >= data.total} onClick={() => setPage((value) => value + 1)}>
                                下一页
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>
        </AppModal>
    );
}

function CastSlot({ kind, pick, onPick, onClear }: { kind: StudioModelKind; pick?: StudioModelPick; onPick: () => void; onClear: () => void }) {
    return (
        <div className="es-cast-slot" data-empty={pick ? undefined : true}>
            <button type="button" className="es-cast-slot-main" onClick={onPick} aria-label={pick ? `更换${STUDIO_MODEL_KIND_LABEL[kind]}：${pick.name}` : `选择${STUDIO_MODEL_KIND_LABEL[kind]}`}>
                <span className="es-cast-slot-image">{pick?.resourceId ? <img src={studioImageUrl(pick.resourceId, true)} alt="" loading="lazy" /> : <UserRound size={16} aria-hidden />}</span>
                <span className="es-cast-slot-text">
                    <span>{STUDIO_MODEL_KIND_LABEL[kind]}</span>
                    <strong>{pick ? pick.name : "不指定"}</strong>
                </span>
            </button>
            {pick ? (
                <button type="button" className="es-icon-btn" aria-label={`不用这个${STUDIO_MODEL_KIND_LABEL[kind]}`} onClick={onClear}>
                    <X size={13} />
                </button>
            ) : null}
        </div>
    );
}

/**
 * 表单里的「模特设定」：出上身效果或用模特拍法时，从模特库选人脸或全身模特、姿势和造型。渲染成出图设置栅格里的一整行。
 * 人脸和全身模特都决定「是谁」，只能留一个：选了其中一个就清掉另一个。
 */
export function StudioModelCastSection({ product, edit }: { product: StudioProduct; edit: Edit }) {
    const [picking, setPicking] = useState<StudioModelKind>();
    const cast = product.brief.model || {};
    const update = (patch: (current: StudioModelCast) => StudioModelCast) =>
        edit(
            (current) => {
                const next = patch(current.brief.model || {});
                const model = next.face || next.figure || next.pose || next.style ? next : undefined;
                return { ...current, brief: { ...current.brief, model } };
            },
            { immediate: true },
        );
    // 放在「出图类型」正下方：选了模特图或模特拍法，设定就出现在刚点的地方。
    return (
        <div className="es-field" data-span={6} role="group" aria-labelledby="es-cast-label">
            <div className="es-field-row">
                <span className="es-field-label" id="es-cast-label">
                    模特设定
                </span>
                <span className="es-field-hint">人脸和全身模特二选一；只用在有模特的图上，不指定时由模型自由发挥</span>
            </div>
            <div className="es-cast">
                {KINDS.map((kind) => (
                    <CastSlot
                        key={kind}
                        kind={kind}
                        pick={cast[kind]}
                        onPick={() => setPicking(kind)}
                        onClear={() =>
                            update((current) => {
                                const next = { ...current };
                                delete next[kind];
                                return next;
                            })
                        }
                    />
                ))}
            </div>
            {picking ? (
                <StudioCastPicker
                    kind={picking}
                    onClose={() => setPicking(undefined)}
                    onPick={(kind, pick) => {
                        update((current) => {
                            const next = { ...current, [kind]: pick };
                            if (kind === "face") delete next.figure;
                            if (kind === "figure") delete next.face;
                            return next;
                        });
                        setPicking(undefined);
                    }}
                />
            ) : null}
        </div>
    );
}
