import { ArrowRight, LoaderCircle, Package, Sparkles } from "lucide-react";
import { Checkbox, Select } from "antd";
import { ModelPicker } from "@/components/model-picker";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { FashionVideoWorkbench } from "@/components/fashion/fashion-video-workbench";
import { CREATIVE_ENTRY_SCENES, CREATIVE_TONES, creativeFactsInput, creativeCastDefaults, creativeCastError, isCommercialCreativeScene, type CreativeBrief, type CreativeCast } from "@/lib/remake/creative";
import { CreativeCastFields } from "./creative-cast-fields";
import type { RemakeProduct } from "@/lib/remake/job";
import type { VideoReplicationRecord } from "@/services/api/video-replication";
import { useUserStore } from "@/stores/use-user-store";
import { HotTopicPicker } from "./hot-topic-picker";
import { ProductVideoImageSlot } from "./replace/product-video-assets";
import { RemakeProductPicker } from "./remake/remake-product-picker";
import { ReplicationComposer } from "./replication-composer";
import { ReplicationRecent } from "./replication-recent";
import { REPLICATION_STAGE_LABELS, type ReplicationRun } from "./use-replication-runner";
import { replicaScriptImageCount, replicaScriptModelError } from "./replication-script";
import { useMaterialAnalysis } from "./use-material-analysis";
import type { CreativeMaterialSuggestion } from "@/lib/remake/materials";

type Props = {
    composer: ComponentProps<typeof ReplicationComposer>;
    records: VideoReplicationRecord[] | undefined;
    loading: boolean;
    error: string;
    activeRun: ReplicationRun | null;
    onOpen: (id: string) => void;
    tabs: ReactNode;
    tab: "new" | "works";
    works: ReactNode;
    onCreative: (brief: CreativeBrief, note: string, ratio: string, product: RemakeProduct, director: { model: string; confirmedInput: string }, cast: CreativeCast) => Promise<void>;
    creating: boolean;
};

const WORKFLOWS = [
    { id: "creative", name: "素材创作" },
    { id: "reference", name: "参考视频复刻" },
    { id: "fashion", name: "人物与服装处理" },
] as const;
const emptyProduct = (): RemakeProduct => ({ name: "", sellingPoints: "", images: [] });

/** 首页直接收集素材与创作要求；作品内复用现有策划、生成与剪辑，处理能力只有一个入口。 */
export function ReplicationHome({ composer, records, loading, error, activeRun, onOpen, tabs, tab, works, onCreative, creating }: Props) {
    const [workflow, setWorkflow] = useState<(typeof WORKFLOWS)[number]["id"]>("creative");
    const [brief, setBrief] = useState<CreativeBrief>({ scene: "selling", tone: "natural", seconds: 15, audience: "", objective: "", brand: "" });
    const [note, setNote] = useState("");
    const [ratio, setRatio] = useState("9:16");
    const [product, setProduct] = useState<RemakeProduct>(emptyProduct);
    const [cast, setCast] = useState(() => creativeCastDefaults("selling"));
    const [castUploading, setCastUploading] = useState(false);
    const [picking, setPicking] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [toolBusy, setToolBusy] = useState(false);
    const [confirmedInput, setConfirmedInput] = useState("");
    const edited = useRef(new Set<keyof CreativeMaterialSuggestion>());
    const userId = useUserStore((state) => state.user?.id);
    const activeRunId = activeRun?.id;
    useEffect(() => {
        setProduct(emptyProduct());
        setNote("");
        setPicking(false);
        setUploading(false);
        setToolBusy(false);
        setCast(creativeCastDefaults(brief.scene));
        setCastUploading(false);
        setConfirmedInput("");
        edited.current.clear();
        setBrief((current) => ({ ...current, audience: "", objective: "", brand: "", topic: undefined }));
    }, [userId]);
    const commercial = isCommercialCreativeScene(brief.scene);
    const locked = creating || uploading || castUploading || toolBusy;
    const analysis = useMaterialAnalysis({
        config: composer.config,
        model: composer.model,
        product,
        brief,
        paused: locked || workflow !== "creative" || tab !== "new",
        onResult: (value) => {
            const preserve = new Set(edited.current);
            setProduct((current) => ({ ...current, name: preserve.has("name") ? current.name : value.name, sellingPoints: preserve.has("sellingPoints") ? current.sellingPoints : value.sellingPoints }));
            setNote((current) => (preserve.has("note") ? current : value.note));
            setBrief((current) => ({
                ...current,
                audience: preserve.has("audience") ? current.audience : value.audience,
                objective: preserve.has("objective") ? current.objective : value.objective,
                brand: preserve.has("brand") ? current.brand : value.brand,
                tone: preserve.has("tone") ? current.tone : value.tone || current.tone,
            }));
            setConfirmedInput("");
        },
    });
    const problem = !product.images.length ? `请添加${commercial ? "商品图" : "主体参考图"}` : !product.name.trim() ? `请填写${commercial ? "商品" : "主体"}名称` : "";
    const factsInput = creativeFactsInput({ product });
    const modelProblem = !composer.model ? "请选择导演策划模型" : replicaScriptModelError(composer.config, composer.model) || (!replicaScriptImageCount(composer.config, composer.model, 1) ? "导演分析需要支持参考图片的文本模型" : "");
    const directorProblem =
        problem || (!Number.isInteger(brief.seconds) || brief.seconds < 4 || brief.seconds > 60 ? "目标片长须为4–60整数秒" : "") || creativeCastError(brief.scene, cast) || modelProblem || (confirmedInput !== factsInput ? "请核对当前图片与主体资料" : "");
    return (
        <div className="vr-home vc-home">
            <header className="vr-home-head">
                <h1 className="vr-home-title">视频创作</h1>
                {tabs}
            </header>
            {activeRunId ? (
                <button type="button" className="vr-run-banner" onClick={() => onOpen(activeRunId)}>
                    <LoaderCircle className="vr-spin" aria-hidden />
                    <span className="vr-run-banner-text">
                        <strong>{REPLICATION_STAGE_LABELS[activeRun.stage]}</strong>
                        {activeRun.detail}
                    </span>
                    <span className="vr-run-banner-link">
                        查看进度
                        <ArrowRight aria-hidden />
                    </span>
                </button>
            ) : null}
            {tab === "works" ? (
                works
            ) : (
                <>
                    <section className="vc-hot-board" aria-label="热点选题">
                        <header>
                            <h2>热点与投放灵感</h2>
                            <span>用于素材创作的视频策划</span>
                        </header>
                        <HotTopicPicker
                            disabled={locked}
                            topic={brief.topic}
                            onChange={(topic) => {
                                setBrief((current) => ({ ...current, topic }));
                                if (topic) {
                                    setWorkflow("creative");
                                }
                            }}
                            onTone={(tone) => {
                                edited.current.add("tone");
                                setBrief((current) => ({ ...current, tone }));
                            }}
                        />
                    </section>
                    <nav className="vc-workflows" aria-label="创作流程">
                        {WORKFLOWS.map((item) => (
                            <button type="button" key={item.id} disabled={locked} aria-pressed={workflow === item.id} onClick={() => setWorkflow(item.id)}>
                                {item.name}
                            </button>
                        ))}
                    </nav>
                    <div className="vc-workspace">
                        <section className="vc-editor" aria-label="视频创作设置">
                            <div hidden={workflow !== "creative"}>
                                <fieldset className="vc-tone">
                                    <legend>视频用途</legend>
                                    <div>
                                        {CREATIVE_ENTRY_SCENES.map((scene) => (
                                            <button
                                                type="button"
                                                key={scene.id}
                                                disabled={locked}
                                                aria-pressed={brief.scene === scene.id}
                                                onClick={() => {
                                                    setBrief((current) => ({ ...current, scene: scene.id }));
                                                    setCast((current) => ({ ...current, people: creativeCastDefaults(scene.id).people, audio: creativeCastDefaults(scene.id).audio }));
                                                }}
                                            >
                                                {scene.name}
                                            </button>
                                        ))}
                                    </div>
                                </fieldset>
                                <div className="vc-creative-content">
                                    <section className="vc-material-section" aria-label="素材与创作要求">
                                        <div className="vc-subject-head">
                                            <h2>
                                                <span className="vc-section-number">1</span>
                                                {commercial ? "商品素材与创作" : "主体素材与创作"}
                                            </h2>
                                            <div className="vc-material-actions">
                                                <ModelPicker
                                                    config={composer.config}
                                                    capability="text"
                                                    value={composer.model}
                                                    onChange={composer.onModelChange}
                                                    placeholder="素材分析与导演模型"
                                                    modelDisabledReason={(option) => (locked || analysis.busy ? "正在处理素材" : !replicaScriptImageCount(composer.config, option, 1) ? "需要支持参考图片" : "")}
                                                />
                                                <button type="button" disabled={locked || analysis.busy || !product.images.length || Boolean(modelProblem)} onClick={analysis.retry}>
                                                    {analysis.busy ? <LoaderCircle size={14} className="vr-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
                                                    {analysis.busy ? "识别中" : "重新识别"}
                                                </button>
                                                {commercial ? (
                                                    <button type="button" disabled={locked} onClick={() => setPicking(true)}>
                                                        <Package size={15} aria-hidden />
                                                        从生图台选商品
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="vc-creative-form">
                                            <div className="vc-material-media">
                                                <ProductVideoImageSlot
                                                    key={userId ?? "signed-out"}
                                                    slot="products"
                                                    displayLabel={commercial ? "商品图" : "主体参考图"}
                                                    hint="添加图片，AI自动识别"
                                                    items={product.images}
                                                    disabled={locked}
                                                    onPendingChange={setUploading}
                                                    onAdd={(images) => setProduct((current) => ({ ...current, images: [...current.images, ...images].slice(0, 4) }))}
                                                    onRemove={(id) => setProduct((current) => ({ ...current, images: current.images.filter((image) => image.id !== id) }))}
                                                />
                                            </div>
                                            <div className="vc-subject-fields">
                                                <label>
                                                    {commercial ? "商品名称" : "主体名称"}
                                                    <input
                                                        aria-label={commercial ? "商品名称" : "主体名称"}
                                                        value={product.name}
                                                        maxLength={60}
                                                        disabled={locked}
                                                        placeholder="AI识别后填写，也可自行修改"
                                                        onChange={(event) => {
                                                            edited.current.add("name");
                                                            setProduct((current) => ({ ...current, name: event.target.value }));
                                                        }}
                                                    />
                                                </label>
                                                <label>
                                                    {commercial ? "商品卖点" : "主体资料"}
                                                    <textarea
                                                        aria-label={commercial ? "商品卖点" : "主体资料"}
                                                        value={product.sellingPoints}
                                                        maxLength={400}
                                                        disabled={locked}
                                                        placeholder="AI提取图片中有依据的信息"
                                                        onChange={(event) => {
                                                            edited.current.add("sellingPoints");
                                                            setProduct((current) => ({ ...current, sellingPoints: event.target.value }));
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                            <div className="vc-direction-fields">
                                                <label className="vc-note">
                                                    创作要求
                                                    <textarea
                                                        aria-label="创作要求"
                                                        value={note}
                                                        maxLength={300}
                                                        disabled={locked}
                                                        placeholder="AI建议拍法，您可补充或修改"
                                                        onChange={(event) => {
                                                            edited.current.add("note");
                                                            setNote(event.target.value);
                                                        }}
                                                    />
                                                </label>
                                                <label>
                                                    目标观众
                                                    <input
                                                        aria-label="创作观众"
                                                        disabled={locked}
                                                        value={brief.audience}
                                                        maxLength={300}
                                                        placeholder="AI推荐适合的人群"
                                                        onChange={(event) => {
                                                            edited.current.add("audience");
                                                            setBrief((current) => ({ ...current, audience: event.target.value }));
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="vc-material-status" role={analysis.error ? "alert" : "status"}>
                                            <span>{analysis.busy ? "正在识别主体、可见卖点与创作建议…" : analysis.error || modelProblem || (analysis.recognized ? "AI已回填，所有内容都可修改。" : "上传后自动识别，按当前文本模型计费。")}</span>
                                            {analysis.questions.length ? (
                                                <details>
                                                    <summary>{analysis.questions.length} 项信息需补充</summary>
                                                    <ul>
                                                        {analysis.questions.map((question) => (
                                                            <li key={question}>{question}</li>
                                                        ))}
                                                    </ul>
                                                </details>
                                            ) : null}
                                        </div>
                                    </section>
                                    <section className="vc-direction-section" aria-label="人物与生成设置">
                                        <h2>
                                            <span className="vc-section-number">2</span>人物、场景与成片设置
                                        </h2>
                                        <CreativeCastFields
                                            key={userId ?? "signed-out"}
                                            scene={brief.scene}
                                            value={cast}
                                            subjectImages={commercial ? undefined : product.images}
                                            config={composer.config}
                                            disabled={locked}
                                            onChange={setCast}
                                            onPendingChange={setCastUploading}
                                        />
                                        <div className="vc-settings">
                                            <label>
                                                视觉风格
                                                <Select
                                                    aria-label="视觉风格"
                                                    disabled={locked}
                                                    value={brief.tone}
                                                    showSearch
                                                    optionFilterProp="label"
                                                    listHeight={240}
                                                    options={Object.entries(CREATIVE_TONES).map(([id, value]) => ({ value: id, label: value.name }))}
                                                    onChange={(tone) => {
                                                        edited.current.add("tone");
                                                        setBrief((current) => ({ ...current, tone }));
                                                    }}
                                                />
                                            </label>
                                            <label>
                                                画幅
                                                <select aria-label="创作画幅" disabled={locked} value={ratio} onChange={(event) => setRatio(event.target.value)}>
                                                    <option value="9:16">竖屏 9:16</option>
                                                    <option value="16:9">横屏 16:9</option>
                                                    <option value="1:1">方形 1:1</option>
                                                </select>
                                            </label>
                                            <label>
                                                目标片长（秒）
                                                <input
                                                    aria-label="创作片长"
                                                    type="number"
                                                    min={4}
                                                    max={60}
                                                    step={1}
                                                    disabled={locked}
                                                    value={brief.seconds}
                                                    onChange={(event) => setBrief((current) => ({ ...current, seconds: Number(event.target.value) }))}
                                                />
                                            </label>
                                        </div>
                                    </section>
                                </div>
                                <section className="vc-director" aria-label="导演分析与策划">
                                    <div>
                                        <Checkbox disabled={locked || analysis.busy || Boolean(problem)} checked={confirmedInput === factsInput} onChange={(event) => setConfirmedInput(event.target.checked ? factsInput : "")}>
                                            图片与主体资料已核对，仅使用已确认信息
                                        </Checkbox>
                                        <p>结合参考图、视频用途与创作要求，生成4个含导演策略的完整脚本。按所选文本模型计费。</p>
                                    </div>
                                </section>
                                <footer className="vc-editor-footer">
                                    <span role="status">
                                        {brief.topic ? `选题：${brief.topic.title} · ` : ""}
                                        {directorProblem || "素材已就绪，可开始导演分析与策划"}
                                    </span>
                                    <button
                                        type="button"
                                        className="vr-create-command"
                                        disabled={locked || analysis.busy || Boolean(directorProblem)}
                                        onClick={() => void onCreative(brief, note, ratio, product, { model: composer.model, confirmedInput }, cast)}
                                    >
                                        {creating ? "正在提交导演策划…" : "导演分析与策划"}
                                        <ArrowRight size={16} aria-hidden />
                                    </button>
                                </footer>
                            </div>
                            <div hidden={workflow !== "reference"}>
                                <ReplicationComposer {...composer} />
                            </div>
                            <div hidden={workflow !== "fashion"}>
                                <FashionVideoWorkbench key={userId ?? "signed-out"} inline initialTool="tryon" onClose={() => setWorkflow("creative")} onBusyChange={setToolBusy} />
                            </div>
                        </section>
                    </div>
                    <ReplicationRecent records={records} loading={loading} error={error} runningId={activeRun?.id || ""} onOpen={onOpen} />
                </>
            )}
            {picking ? (
                <RemakeProductPicker
                    onClose={() => setPicking(false)}
                    onPick={(value) => {
                        if (value.name.trim()) edited.current.add("name");
                        if (value.sellingPoints.trim()) edited.current.add("sellingPoints");
                        setProduct(value);
                        setPicking(false);
                    }}
                />
            ) : null}
        </div>
    );
}
