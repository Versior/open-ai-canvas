import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "antd";
import { ArrowUp, Film, Link2, LoaderCircle, Paperclip, Plus, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { useActiveAgentPet } from "@/hooks/use-active-agent-pet";
import { useAgentPetPalette } from "@/hooks/use-agent-pet-palette";
import { agentSkinTheme, resolveAgentSkin } from "@/lib/canvas/agent-skin";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import { FashionVideoWorkbench } from "@/components/fashion/fashion-video-workbench";
import { GenerationCostNotice } from "@/components/generation-cost-notice";
import { ModelPicker } from "@/components/model-picker";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { readVideoReplicationAnalysis, videoTeardownModelError } from "@/lib/canvas/video-teardown";
import { FASHION_VIDEO_TOOLS, type FashionVideoTool } from "@/lib/fashion/video-workflow";
import { CREATIVE_SCENES, CREATIVE_TONES, creativeFactsInput, creativeCastDefaults, creativeCastError, type CreativeBrief, type CreativeCast } from "@/lib/remake/creative";
import type { RemakeProduct } from "@/lib/remake/job";
import { VIDEO_CHAT_INTENTS, type VideoChatIntent } from "@/lib/remake/video-chat";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceFileUrl } from "@/services/api/resources";
import { getVideoReplication, parseVideoTeardownBundle, type VideoReplicationDetail, type VideoReplicationRecord } from "@/services/api/video-replication";
import { CreativeCastFields } from "./creative-cast-fields";
import { HotTopicPicker } from "./hot-topic-picker";
import { ProductVideoImageSlot } from "./replace/product-video-assets";
import { RemakeProductPicker } from "./remake/remake-product-picker";
import type { ReplicationComposer } from "./replication-composer";
import { ReplicationProgress } from "./replication-progress";
import { ReplicationRecent } from "./replication-recent";
import { replicaScriptImageCount, replicaScriptModelError } from "./replication-script";
import { useMaterialAnalysis } from "./use-material-analysis";
import { videoReplicationKeys, type ReplicationRun, type ReplicationSource } from "./use-replication-runner";
import { useVideoChat } from "./use-video-chat";
import { useVideoChatHistory } from "./use-video-chat-history";
import "@/components/canvas/canvas-cloud-agent.css";
import "@/components/canvas/agent-skin-scene.css";
import "./video-chat.css";

export type ChatRemakeOptions = { mode: "structure" | "style" | "elements"; product: RemakeProduct; note: string; seconds: number; ratio?: string };
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
    referenceId: string;
    onReferenceChange: (id: string) => void;
    onRemake: (record: VideoReplicationDetail, title: string, options: ChatRemakeOptions) => Promise<void>;
    onCreative: (brief: CreativeBrief, note: string, ratio: string, product: RemakeProduct, director: { model: string; confirmedInput: string }, cast: CreativeCast) => Promise<void>;
    creating: boolean;
};
const emptyProduct = (): RemakeProduct => ({ name: "", sellingPoints: "", images: [] });
const initialBrief = (): CreativeBrief => ({ scene: "showcase", tone: "natural", seconds: 15, audience: "", objective: "", brand: "" });
const quickIds = ["creative", "structure", "style", "elements", "face", "tryon"];

/** 对话整理需求，解析、素材识别、策划与生成使用现有真实任务。 */
export function ReplicationHome({ composer, records, loading, error, activeRun, onOpen, tabs, tab, works, onCreative, creating, referenceId, onReferenceChange, onRemake }: Props) {
    const skinPreference = useAgentPetPrefsStore((state) => state.skin);
    const { pet } = useActiveAgentPet();
    const skin = resolveAgentSkin(skinPreference, pet?.tone);
    const palette = useAgentPetPalette(pet, skinPreference === "auto");
    const theme = agentSkinTheme(canvasThemes[useActiveTheme()], skin, palette);
    const [intent, setIntent] = useState<VideoChatIntent>("creative");
    const [brief, setBrief] = useState(initialBrief);
    const [note, setNote] = useState("");
    const [ratio, setRatio] = useState("9:16");
    const [product, setProduct] = useState(emptyProduct);
    const [cast, setCast] = useState(() => creativeCastDefaults("showcase"));
    const [text, setText] = useState("");
    const [panel, setPanel] = useState<"settings" | "functions" | "history" | "conversations" | "inspiration" | null>(null);
    const [picking, setPicking] = useState(false);
    const [fashion, setFashion] = useState<FashionVideoTool>();
    const [uploading, setUploading] = useState(false);
    const [castUploading, setCastUploading] = useState(false);
    const [toolBusy, setToolBusy] = useState(false);
    const [starting, setStarting] = useState(false);
    const [confirmedInput, setConfirmedInput] = useState("");
    const [inputError, setInputError] = useState("");
    const [restoredImages, setRestoredImages] = useState("");
    const input = useRef<HTMLTextAreaElement>(null);
    const videoInput = useRef<HTMLInputElement>(null);
    const submittedLink = useRef("");
    const scroll = useRef<HTMLDivElement>(null);
    const nextStep = useRef<HTMLElement>(null);
    const edited = useRef(new Set<"name" | "sellingPoints" | "note" | "audience" | "objective" | "brand" | "tone" | "ratio">());
    const scope = getActiveUserScope();
    const reference = useQuery({
        queryKey: videoReplicationKeys.detail(scope, referenceId),
        queryFn: ({ signal }) => getVideoReplication(referenceId, signal),
        enabled: Boolean(referenceId),
        refetchInterval: (query) => (query.state.data?.task.status === "queued" || query.state.data?.task.status === "running" ? 2000 : false),
        select: (record) => {
            const bundle = record.task.status === "succeeded" ? parseVideoTeardownBundle(record.task) : null;
            return { record, bundle, analysis: bundle ? readVideoReplicationAnalysis(record.analysis, bundle.shots.length) : null };
        },
    });
    const source = reference.data?.bundle;
    const analysisResult = reference.data?.analysis;
    useEffect(() => {
        if (!analysisResult || !submittedLink.current) return;
        const link = submittedLink.current;
        setText((current) => (current.trim() === link ? "" : current));
        submittedLink.current = "";
    }, [analysisResult]);
    const chosen = VIDEO_CHAT_INTENTS.find((item) => item.id === intent)!;
    const fashionTool = FASHION_VIDEO_TOOLS.find((item) => item.id === intent);
    const history = useVideoChatHistory({ intent, brief, ratio, note, product, cast, text, referenceId, model: composer.model, transcribe: composer.transcribe, confirmedInput, edited: [...edited.current] }, (draft) => {
        setIntent(draft.intent);
        setBrief(draft.brief);
        setRatio(draft.ratio);
        setNote(draft.note);
        setProduct(draft.product);
        setCast(draft.cast);
        setText(draft.text);
        setConfirmedInput(draft.confirmedInput);
        setRestoredImages(draft.product.images.map((image) => image.resourceId).join("|"));
        edited.current = new Set(draft.edited);
        submittedLink.current = "";
        setInputError("");
        setFashion(undefined);
        if (draft.model !== composer.model) composer.onModelChange(draft.model);
        if (draft.transcribe !== composer.transcribe) composer.onTranscribeChange(draft.transcribe);
        onReferenceChange(draft.referenceId);
    });
    const chat = useVideoChat(
        composer.config,
        composer.model,
        {
            intent,
            brief,
            ratio,
            note,
            subject: { name: product.name, facts: product.sellingPoints, images: product.images.length },
            reference: analysisResult ? JSON.stringify(analysisResult.summary) : source ? `已拆出${source.shots.length}镜，模型分析尚未完成` : "尚未添加参考视频",
        },
        (reply) => {
            setIntent(reply.intent);
            setBrief((current) => ({ ...current, scene: reply.scene, tone: reply.tone, seconds: reply.seconds }));
            if (reply.scene !== brief.scene) setCast((current) => ({ ...current, people: creativeCastDefaults(reply.scene).people, audio: creativeCastDefaults(reply.scene).audio }));
            setRatio(reply.ratio);
            setNote(reply.note);
            edited.current.add("note");
            if (reply.tone !== brief.tone) edited.current.add("tone");
            if (reply.ratio !== ratio) edited.current.add("ratio");
        },
        history,
    );
    const restoredMaterials = Boolean(restoredImages) && restoredImages === product.images.map((image) => image.resourceId).join("|");
    const materialAnalysis = useMaterialAnalysis({
        config: composer.config,
        model: composer.model,
        product,
        brief,
        paused: !history.ready || restoredMaterials || uploading || chat.busy || creating || tab !== "new" || Boolean(fashionTool),
        onResult: (result) => {
            setProduct((current) => ({ ...current, name: edited.current.has("name") ? current.name : result.name, sellingPoints: edited.current.has("sellingPoints") ? current.sellingPoints : result.sellingPoints }));
            if (!edited.current.has("note")) setNote(result.note);
            setBrief((current) => ({
                ...current,
                audience: edited.current.has("audience") ? current.audience : result.audience,
                objective: edited.current.has("objective") ? current.objective : result.objective,
                brand: edited.current.has("brand") ? current.brand : result.brand,
                tone: edited.current.has("tone") ? current.tone : result.tone || current.tone,
            }));
            setConfirmedInput("");
            chat.say("assistant", `图片里识别到：${result.name}。主体资料放在下面，核对后我们再排方案。${result.questions.length ? `还需要确认：${result.questions.join("；")}` : ""}`);
        },
    });
    const locked = !history.ready || chat.busy || composer.busy || uploading || castUploading || toolBusy || creating || starting || materialAnalysis.busy;
    const started = chat.turns.length > 0 || Boolean(referenceId);
    const factsInput = creativeFactsInput({ product });
    const modelProblem = !composer.model ? "请选择视频导演模型" : replicaScriptModelError(composer.config, composer.model);
    const directionNote = edited.current.has("tone") ? `${note}\n画风要求：${CREATIVE_TONES[brief.tone].prompt}`.trim() : note;
    const subjectProblem = !product.images.length ? "先添加主体图片" : !product.name.trim() ? "先确认主体名称" : confirmedInput !== factsInput ? "请核对当前图片和主体资料" : "";
    const durationProblem = !Number.isInteger(brief.seconds) || brief.seconds < (intent === "style" ? 5 : 4) || brief.seconds > 60 ? `目标片长须为${intent === "style" ? 5 : 4}–60整数秒` : "";
    const planProblem =
        subjectProblem ||
        (intent === "creative"
            ? durationProblem || creativeCastError(brief.scene, cast) || modelProblem || (!replicaScriptImageCount(composer.config, composer.model, product.images.length) ? "导演模型需要支持参考图片" : "")
            : !analysisResult
              ? "请先完成参考视频分析"
              : intent === "style"
                ? durationProblem
                : "");
    useEffect(() => {
        scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
    }, [chat.turns, chat.busy, chat.error, inputError, reference.data, materialAnalysis.busy]);
    const choose = (next: VideoChatIntent) => {
        const item = VIDEO_CHAT_INTENTS.find((value) => value.id === next)!;
        setIntent(next);
        setPanel(null);
        chat.say("user", item.reply);
        chat.say("assistant", item.description);
        input.current?.focus();
    };
    const startSource = (value: ReplicationSource) => {
        const problem = videoTeardownModelError(composer.config, composer.model) || (value.kind === "link" && !composer.linkImportEnabled ? "链接解析暂未启用，可以上传本地视频" : "");
        if (problem) {
            setInputError(problem);
            return false;
        }
        setInputError("");
        if (intent === "creative") setIntent("structure");
        chat.say("user", value.kind === "file" ? `上传参考视频：${value.file.name}` : value.text);
        composer.onStart(value, { model: composer.model, transcribe: composer.transcribe });
        return true;
    };
    const send = () => {
        if (!text.trim() || locked) return;
        if (/https?:\/\//i.test(text)) {
            if (startSource({ kind: "link", text: text.trim() })) submittedLink.current = text.trim();
            return;
        }
        if (modelProblem) {
            setInputError(modelProblem);
            return;
        }
        setInputError("");
        void chat.send(text.trim()).then((sent) => {
            if (sent) setText("");
        });
    };
    const reset = () => {
        chat.reset();
        materialAnalysis.retry();
        setPanel(null);
    };
    const startPlan = async () => {
        if (locked || planProblem) return;
        setStarting(true);
        setInputError("");
        try {
            if (intent === "creative") {
                await onCreative(brief, note, ratio, product, { model: composer.model, confirmedInput }, cast);
                return;
            }
            if (reference.data && (intent === "structure" || intent === "style" || intent === "elements"))
                await onRemake(reference.data.record, analysisResult?.title || "参考视频", { mode: intent, product, note: directionNote, seconds: brief.seconds, ...(edited.current.has("ratio") ? { ratio } : {}) });
        } catch (cause) {
            setInputError(cause instanceof Error ? cause.message : "创建方案失败");
        } finally {
            setStarting(false);
        }
    };
    const choices = (all = false) => (
        <div className="vchat-replies">
            {VIDEO_CHAT_INTENTS.filter((item) => all || quickIds.includes(item.id)).map((item) => (
                <button key={item.id} type="button" disabled={locked} onClick={() => choose(item.id)}>
                    {item.reply}
                </button>
            ))}
        </div>
    );

    return (
        <div className="vchat-page">
            <header className="vr-home-head">
                <h1 className="vr-home-title">视频创作</h1>
                {tabs}
            </header>
            <div hidden={tab !== "new"} className="vchat-session agent-chat-theme" data-skin={skin} style={{ "--agent-surface-base": theme.node.panel, "--agent-ink": theme.node.text, "--agent-accent": theme.accent.primary } as CSSProperties}>
                <div className="vchat-toolbar">
                    <span>{started ? chosen.title : "和视频导演聊聊"}</span>
                    <div>
                        <span className="vchat-muted" role="status">
                            {history.error ? (history.ready ? "未保存" : "读取失败") : !history.ready ? "正在读取对话…" : history.saving ? "正在保存…" : scope === "guest" ? "登录后保存" : "已保存到本机"}
                        </span>
                        <button disabled={locked} onClick={() => setPanel("conversations")}>
                            对话历史
                        </button>
                        <button disabled={locked} onClick={() => setPanel("history")}>
                            最近拆解
                        </button>
                        <button disabled={locked} onClick={() => setPanel("settings")}>
                            <SlidersHorizontal size={15} />
                            创作设置
                        </button>
                        <button disabled={locked} aria-label="新建视频对话" onClick={reset}>
                            <Plus size={17} />
                        </button>
                    </div>
                </div>
                <div className="vchat-turns" ref={scroll}>
                    <article className="vchat-assistant vchat-opening">
                        <span className="vchat-speaker">
                            <Sparkles size={15} />
                            视频导演
                        </span>
                        <h2>今天，我们拍点什么？</h2>
                        <p>
                            发我一条视频链接，我帮你拆镜头、找灵感。
                            <br />
                            也可以从你的图片和想法开始，一起把它拍出来。
                        </p>
                        {!started ? (
                            <>
                                <p className="vchat-muted">可以直接说，也可以这样开个头：</p>
                                {choices()}
                                <button className="vchat-text-action" onClick={() => setPanel("inspiration")}>
                                    看看热点与投放灵感
                                </button>
                            </>
                        ) : null}
                    </article>
                    {chat.turns.map((turn, index) => (
                        <article key={index} className={`vchat-${turn.role} agent-message-body${turn.role === "user" ? " agent-message-user" : ""}`}>
                            {turn.role === "assistant" ? (
                                <span className="vchat-speaker">
                                    <Sparkles size={15} />
                                    视频导演
                                </span>
                            ) : null}
                            <p>{turn.text}</p>
                        </article>
                    ))}
                    {chat.busy ? (
                        <p role="status" className="vchat-status">
                            <LoaderCircle className="vr-spin" size={15} />
                            导演正在整理你的要求…
                        </p>
                    ) : null}
                    {composer.run ? (
                        <div className="vchat-assistant">
                            <ReplicationProgress run={composer.run} />
                        </div>
                    ) : null}
                    {referenceId && reference.isPending ? <p role="status">正在读取参考视频…</p> : null}
                    {reference.isError ? (
                        <p role="alert">
                            {reference.error.message}
                            <button onClick={() => void reference.refetch()}>重新读取</button>
                        </p>
                    ) : null}
                    {source ? (
                        <article className="vchat-assistant">
                            <span className="vchat-speaker">
                                <Film size={15} />
                                参考视频
                            </span>
                            <p>
                                {analysisResult?.title || "视频已拆解"} · {(source.source.durationMs / 1000).toFixed(1)}秒 · {source.shots.length}个镜头
                            </p>
                            {analysisResult?.summary ? <p>{analysisResult.summary.hook}</p> : <p className="vchat-muted">镜头已就绪，完整画面分析尚未完成。</p>}
                            <details>
                                <summary>展开镜头与口播</summary>
                                <video className="vchat-video" src={resourceFileUrl(source.source.resourceId)} controls preload="metadata" />
                                <ol>
                                    {source.shots.map((shot) => (
                                        <li key={shot.index}>
                                            {(shot.startMs / 1000).toFixed(1)}–{(shot.endMs / 1000).toFixed(1)}秒 · {analysisResult?.rows.find((row) => row.shotNumber === shot.index)?.plotDescription || "镜头 " + shot.index}
                                        </li>
                                    ))}
                                </ol>
                                <p>{source.transcript.segments.map((segment) => segment.text).join(" ") || source.transcript.note || "没有可用的口播转写"}</p>
                                <button onClick={() => onOpen(referenceId)}>打开完整拆解</button>
                            </details>
                            {choices()}
                        </article>
                    ) : null}
                    {started && !chat.busy ? (
                        <article ref={nextStep} className="vchat-assistant vchat-next">
                            <span className="vchat-speaker">
                                <Sparkles size={15} />
                                接着聊
                            </span>
                            {fashionTool ? (
                                <>
                                    <p>{source ? "原片有了，接着确认目标图片与处理范围。" : "把原视频链接发我，或在素材面板上传视频与目标图片。"}</p>
                                    <button className="vr-create-command" disabled={locked} onClick={() => setFashion(fashionTool.id)}>
                                        准备{fashionTool.title}素材
                                    </button>
                                    <p className="vchat-muted">素材、选段、模型与费用确认后才开始生成。</p>
                                </>
                            ) : intent !== "creative" && !source ? (
                                <>
                                    <p>先把参考视频链接发到下面，也可以直接上传本地视频。</p>
                                    <button disabled={locked} onClick={() => videoInput.current?.click()}>
                                        <Film size={15} />
                                        上传参考视频
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p>{product.images.length ? "核对一下主体资料，再告诉我想保留或改变什么。" : "发我一张主体图片，我们接着聊拍法。"}</p>
                                    <ProductVideoImageSlot
                                        slot="products"
                                        displayLabel="主体图片"
                                        hint="上传、拖入或从素材库选择"
                                        items={product.images}
                                        disabled={locked}
                                        onPendingChange={setUploading}
                                        onAdd={(images) => setProduct((current) => ({ ...current, images: [...current.images, ...images].slice(0, 4) }))}
                                        onRemove={(id) => setProduct((current) => ({ ...current, images: current.images.filter((image) => image.id !== id) }))}
                                    />
                                    <button className="vchat-text-action" disabled={locked} onClick={() => setPicking(true)}>
                                        从生图台选择商品
                                    </button>
                                    {materialAnalysis.busy ? <p role="status">正在识别图片中的主体与可见资料…</p> : null}
                                    {materialAnalysis.error || restoredMaterials ? (
                                        <p role="alert">
                                            {materialAnalysis.error || "已恢复素材资料"}
                                            <button
                                                disabled={locked}
                                                onClick={() => {
                                                    setRestoredImages("");
                                                    materialAnalysis.retry();
                                                }}
                                            >
                                                重新识别
                                            </button>
                                        </p>
                                    ) : null}
                                    {product.images.length ? (
                                        <>
                                            <div className="vchat-fields">
                                                <label>
                                                    主体名称
                                                    <input
                                                        value={product.name}
                                                        maxLength={60}
                                                        disabled={locked}
                                                        onChange={(event) => {
                                                            edited.current.add("name");
                                                            setProduct((value) => ({ ...value, name: event.target.value }));
                                                        }}
                                                    />
                                                </label>
                                                <label>
                                                    已确认的主体资料
                                                    <textarea
                                                        value={product.sellingPoints}
                                                        maxLength={400}
                                                        disabled={locked}
                                                        onChange={(event) => {
                                                            edited.current.add("sellingPoints");
                                                            setProduct((value) => ({ ...value, sellingPoints: event.target.value }));
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                            <Checkbox disabled={locked || !product.name.trim()} checked={confirmedInput === factsInput} onChange={(event) => setConfirmedInput(event.target.checked ? factsInput : "")}>
                                                图片与主体资料已核对
                                            </Checkbox>
                                            {intent === "creative" ? (
                                                <details open={Boolean(creativeCastError(brief.scene, cast))}>
                                                    <summary>人物、场景与声音</summary>
                                                    <CreativeCastFields scene={brief.scene} value={cast} subjectImages={product.images} config={composer.config} disabled={locked} onChange={setCast} onPendingChange={setCastUploading} />
                                                </details>
                                            ) : null}
                                            <p className="vchat-muted">
                                                {intent === "structure" || intent === "elements" ? "沿用原片时长" : `${brief.seconds}秒`} · {intent === "creative" || edited.current.has("ratio") ? ratio : "沿用原片画幅"} ·{" "}
                                                {intent === "creative" || edited.current.has("tone") ? CREATIVE_TONES[brief.tone].name : "参考原片风格"}
                                                {note ? ` · ${note}` : ""}
                                            </p>
                                            <button className="vr-create-command" disabled={locked || Boolean(planProblem)} onClick={() => void startPlan()}>
                                                {starting || creating ? "正在准备方案…" : "好，开始策划"}
                                            </button>
                                            <p className="vchat-muted">{planProblem || (intent === "creative" ? "生成导演方案后，进入工作台确认首镜与成片。" : "进入复刻工作台，确认方案后再生成视频。")}</p>
                                        </>
                                    ) : null}
                                </>
                            )}
                        </article>
                    ) : null}
                    {inputError || chat.error ? (
                        <p role="alert" className="vchat-error">
                            {inputError || chat.error}
                        </p>
                    ) : null}
                    {history.error ? (
                        <p role="alert" className="vchat-error">
                            {history.error}
                            {history.ready ? <button onClick={history.retrySave}>重试保存</button> : null}
                        </p>
                    ) : null}
                </div>
                <form
                    className="vchat-composer agent-composer-surface"
                    onSubmit={(event) => {
                        event.preventDefault();
                        send();
                    }}
                >
                    <textarea
                        ref={input}
                        aria-label="告诉导演你的创作要求"
                        placeholder="把视频链接发给我，或者聊聊你想拍什么…"
                        maxLength={2000}
                        value={text}
                        disabled={locked}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                send();
                            }
                        }}
                    />
                    <div className="vchat-compose-tools">
                        <div>
                            <button
                                type="button"
                                disabled={locked}
                                onClick={() => {
                                    if (fashionTool) {
                                        setFashion(fashionTool.id);
                                        return;
                                    }
                                    if (!started) {
                                        choose("creative");
                                        return;
                                    }
                                    nextStep.current?.scrollIntoView({ block: "start" });
                                }}
                            >
                                <Paperclip size={15} />
                                加素材
                            </button>
                            <button
                                type="button"
                                disabled={locked}
                                onClick={() => {
                                    if (intent === "creative") setIntent("structure");
                                    chat.say("assistant", composer.linkImportEnabled ? "把分享链接直接发到这里，或选择本地视频。支持的平台以后台配置为准。" : "当前未启用链接解析，可以上传本地视频。");
                                    input.current?.focus();
                                }}
                            >
                                <Link2 size={15} />
                                解析链接
                            </button>
                            <button type="button" disabled={locked} onClick={() => setPanel("functions")}>
                                更多
                            </button>
                        </div>
                        <button
                            type="submit"
                            className="agent-composer-send"
                            disabled={locked || !text.trim()}
                            aria-label="发送创作要求"
                            style={{ background: locked || !text.trim() ? theme.spatial.surface : theme.accent.primary, color: locked || !text.trim() ? theme.node.muted : theme.accent.onPrimary }}
                        >
                            <span className="agent-composer-send-content">
                                <ArrowUp size={14} />
                                <span>发送</span>
                            </span>
                        </button>
                    </div>
                    <div className="vchat-cost">
                        <ModelPicker config={composer.config} capability="text" value={composer.model} onChange={composer.onModelChange} placeholder="选择视频导演模型" modelDisabledReason={() => (locked ? "正在处理当前内容" : "")} />
                        <GenerationCostNotice config={composer.config} model={composer.model} capability="text" label="导演对话" />
                        <span>对话与素材识别按所选文本模型计费</span>
                    </div>
                </form>
                <input
                    hidden
                    type="file"
                    accept="video/*"
                    ref={videoInput}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file && !locked) startSource({ kind: "file", file });
                        event.target.value = "";
                    }}
                />
            </div>
            {tab === "works" ? works : null}
            <AppDrawer
                open={panel !== null}
                title={panel === "conversations" ? "对话历史" : panel === "settings" ? "创作设置" : panel === "functions" ? "更多视频玩法" : panel === "inspiration" ? "热点与投放灵感" : "最近拆解"}
                onClose={() => setPanel(null)}
                size={480}
            >
                {panel === "conversations" ? (
                    <div className="vchat-history">
                        {[...history.sessions]
                            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                            .map((session) => (
                                <button
                                    key={session.id}
                                    disabled={locked}
                                    aria-current={session.id === history.activeId ? "true" : undefined}
                                    onClick={() => {
                                        chat.open(session.id);
                                        setPanel(null);
                                    }}
                                >
                                    <strong>{session.turns.find((turn) => turn.role === "user")?.text.slice(0, 48) || session.draft.text.slice(0, 48) || "新对话"}</strong>
                                    <span>
                                        {session.turns.length} 条消息 · {new Date(session.updatedAt).toLocaleString()}
                                    </span>
                                </button>
                            ))}
                    </div>
                ) : null}
                {panel === "functions" ? (
                    <>
                        {choices(true)}
                        <button type="button" className="vchat-text-action" disabled={locked} onClick={() => setPanel("inspiration")}>
                            热点与投放灵感
                        </button>
                    </>
                ) : null}
                {panel === "history" ? <ReplicationRecent records={records} loading={loading} error={error} runningId={activeRun?.id || ""} onOpen={onOpen} /> : null}
                {panel === "inspiration" ? (
                    <HotTopicPicker
                        disabled={locked}
                        topic={brief.topic}
                        onChange={(topic) => {
                            setBrief((current) => ({ ...current, topic }));
                            if (topic) {
                                setIntent("creative");
                                chat.say("user", `围绕“${topic.title}”拍一条视频。`);
                                setPanel(null);
                            }
                        }}
                        onTone={(tone) => {
                            edited.current.add("tone");
                            setBrief((current) => ({ ...current, tone }));
                        }}
                    />
                ) : null}
                {panel === "settings" ? (
                    <div className="vchat-fields">
                        <label>
                            视频用途
                            <select
                                value={brief.scene}
                                disabled={locked}
                                onChange={(event) => {
                                    const scene = CREATIVE_SCENES.find((item) => item.id === event.target.value)!.id;
                                    setBrief((current) => ({ ...current, scene }));
                                    setCast((current) => ({ ...current, people: creativeCastDefaults(scene).people, audio: creativeCastDefaults(scene).audio }));
                                }}
                            >
                                {CREATIVE_SCENES.map((scene) => (
                                    <option key={scene.id} value={scene.id}>
                                        {scene.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            画幅
                            <select
                                disabled={locked}
                                value={ratio}
                                onChange={(event) => {
                                    edited.current.add("ratio");
                                    setRatio(event.target.value);
                                }}
                            >
                                {["9:16", "16:9", "1:1"].map((value) => (
                                    <option key={value}>{value}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            目标时长（秒）
                            <input type="number" min={intent === "style" ? 5 : 4} max={60} disabled={locked} value={brief.seconds} onChange={(event) => setBrief((current) => ({ ...current, seconds: Number(event.target.value) }))} />
                        </label>
                        <label>
                            视觉风格
                            <select
                                disabled={locked}
                                value={brief.tone}
                                onChange={(event) => {
                                    edited.current.add("tone");
                                    setBrief((current) => ({ ...current, tone: event.target.value as CreativeBrief["tone"] }));
                                }}
                            >
                                {Object.entries(CREATIVE_TONES).map(([id, tone]) => (
                                    <option key={id} value={id}>
                                        {tone.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            拍摄要求
                            <textarea
                                disabled={locked}
                                maxLength={300}
                                value={note}
                                onChange={(event) => {
                                    edited.current.add("note");
                                    setNote(event.target.value);
                                }}
                            />
                        </label>
                        {(
                            [
                                ["audience", "目标观众"],
                                ["objective", "视频目标"],
                                ["brand", "品牌要求"],
                            ] as const
                        ).map(([field, label]) => (
                            <label key={field}>
                                {label}
                                <input
                                    disabled={locked}
                                    value={brief[field]}
                                    maxLength={200}
                                    onChange={(event) => {
                                        edited.current.add(field);
                                        setBrief((current) => ({ ...current, [field]: event.target.value }));
                                    }}
                                />
                            </label>
                        ))}
                        <Checkbox disabled={locked || Boolean(composer.transcribeNote)} checked={composer.transcribe} onChange={(event) => composer.onTranscribeChange(event.target.checked)}>
                            解析时识别口播
                        </Checkbox>
                        <p>{composer.transcribeNote}</p>
                    </div>
                ) : null}
            </AppDrawer>
            {picking ? (
                <RemakeProductPicker
                    onClose={() => setPicking(false)}
                    onPick={(value) => {
                        edited.current.add("name");
                        edited.current.add("sellingPoints");
                        setProduct(value);
                        setPicking(false);
                    }}
                />
            ) : null}
            {fashion ? (
                <FashionVideoWorkbench
                    initialTool={fashion}
                    initialNote={directionNote}
                    initialSource={source ? { ...source.source, name: analysisResult?.title || "参考视频" } : undefined}
                    onClose={() => {
                        if (!toolBusy) setFashion(undefined);
                    }}
                    onBusyChange={setToolBusy}
                />
            ) : null}
        </div>
    );
}
