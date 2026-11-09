import { jsonCandidates } from "@/lib/canvas/video-teardown";
import { DEFAULT_REPLICA_CAMPAIGN, REPLICA_DIRECTOR_OPTIONS, readReplicaDirection, readReplicaStrategy, replicaCampaignPrompt, type ReplicaDirection, type ReplicaStrategy } from "@/lib/canvas/replica-director";
import { REPLICA_METHODS, REPLICA_NARRATIVES, replicaMethodGuidance } from "@/lib/canvas/replica-director-knowledge";
import { remakeDialogueBudget } from "./prompts";
import type { RemakeJob } from "./job";

export type RemakeDirectorPlan = { id: string; angle: string; strategy: ReplicaStrategy; lines: { shotNumber: number; dialogue: string; onScreenText: string; director?: ReplicaDirection }[]; model: string; createdAt: string; input: string };

export function replicaProductFacts(sellingPoints: string) {
    return sellingPoints
        .split(/\n+/)
        .map((line) => line.replace(/^\s*(?:[-*·•]\s*|\d+[.、)]\s*)/, "").trim())
        .filter(Boolean);
}

/** 保存策划时的输入快照；商品、目标、做法与口播语言改变后提示重新策划。 */
export function remakeDirectorInput(job: RemakeJob) {
    return JSON.stringify([
        job.product,
        job.campaign,
        job.people,
        job.models,
        job.backgrounds,
        job.audio,
        job.language,
        job.note,
        job.shots.map(({ index, startMs, endMs, treatment, plot, originalDialogue, camera, motion, speaker }) => ({ index, startMs, endMs, treatment, plot, originalDialogue, camera, motion, speaker })),
        job.sourceSummary,
    ]);
}

export function buildRemakeDirectorPrompt(job: RemakeJob, count = 2, imageCount = 0) {
    const kept = job.shots.filter((shot) => shot.treatment !== "skip");
    const campaign = job.campaign || DEFAULT_REPLICA_CAMPAIGN;
    return [
        `你是视频导演与创意策划。输出 ${count} 个可比较、可拍摄的策划版本，每版先做全片策略，再把策略落实到逐镜动作和口播。不能只换台词或堆导演名词。`,
        `商品事实：${JSON.stringify({ name: job.product.name, facts: replicaProductFacts(job.product.sellingPoints), images: job.product.images.length })}。${imageCount ? `附件图1至图${imageCount}是新商品实拍：观察真实外观、颜色和可见结构来决定拍法与色调，图片不能证明性能、材质成分或操作方式；未附原视频，原片只能依据下面的拆解。` : "本请求不包含图片，不能声称看过商品图或原片；只基于下面的拆解与文字事实策划。"}`,
        `原片拆解摘要：${JSON.stringify(job.sourceSummary)}。补充要求：${job.note || "无"}。`,
        replicaCampaignPrompt(campaign),
        `可比较拍法（选择一种主要拍法并解释为什么；用户指定拍法时遵守）：${Object.entries(REPLICA_METHODS)
            .filter(([key]) => key !== "auto")
            .map(([key, method]) => `${key}=${method.name}：${replicaMethodGuidance(key as keyof typeof REPLICA_METHODS)}`)
            .join("\n")}`,
        `叙事可选：${JSON.stringify(REPLICA_NARRATIVES)}。不能把每个商品都排成固定五段；少于五镜时也不得添加镜头。不同版本必须改变观众切入问题、主张或动作证据，不能只改标题。`,
        `人物设置：${job.people}；人物图${job.models.length}张，场景图${job.backgrounds.length}张。口播模式：${job.audio}；语言：${job.language}。只在 rewrite/voice 模式改台词；其他模式 dialogue 写空字符串。`,
        "逐镜事实与不可改动的执行方式：",
        ...kept.map(
            (shot) =>
                `镜头${shot.index}｜${(shot.endMs - shot.startMs) / 1000}秒｜做法${shot.treatment}｜口播上限${remakeDialogueBudget(shot, job.language)}字符｜说话者${shot.speaker ? "人物对镜头" : "旁白"}｜原画面${shot.plot || "未提供"}｜原运镜${shot.camera} ${shot.motion}｜原口播${shot.originalDialogue || "无"}`,
        ),
        "replace 镜头保留原动作、机位和节奏，只适配口播，不用导演策划覆盖原动作；keep 镜头完整保留，不改口播、画面字和导演；remake 镜头才重新设计动作。不得改变 treatment、镜头编号、时长、授权或音频模式。不能跳过需要保留的镜头。",
        "全片 strategy 的 hook、visual、rationale 和步骤数也必须遵守上述边界，不能口头宣称 replace/keep 镜会改成新景别、微距或新操作。只有一镜 remake 时，就只能策划一个新动作，其余作用依据原画面说明；若无法完成目标，写入 missing。replace/keep 的 line 不输出 director，keep 的 dialogue 和 onScreenText 均写空字符串，表示沿用现有编辑。",
        "每版 strategy 必须明确：audience（观众及购买角色）、insight（具体顾虑）、proposition（一条商品主张）、hook（第一镜可见的钩子）、method（所选拍法）、narrative（叙事方式）、rationale（为什么适合此商品、平台与镜头预算，原片哪些可借、哪些不适合）、visual（环境、色调、布光及原因）、sound（服从音频模式的声音和剪辑意图）、cta（目标对应的收束）、missing（缺资料或需核实的事项）。不得捏造市场统计、亲测、功效、价格、认证或商品参数。",
        `remake 的每条 line 必须有 director：beat、framing、camera、transition 从 ${JSON.stringify({ beat: REPLICA_DIRECTOR_OPTIONS.beat, framing: REPLICA_DIRECTOR_OPTIONS.framing, camera: REPLICA_DIRECTOR_OPTIONS.camera, transition: REPLICA_DIRECTOR_OPTIONS.transition })} 中选一个；purpose 是这镜消除的顾虑或带来的新信息，start 是动作前状态，action 是一镜能完成的动作过程，end 是动作后可见状态，lighting 是布光与色调，sound 是声音意图，evidence 只逐字引用商品 facts 的一条，没依据写空；proof 必须有依据。`,
        `evidence 的合法字符串仅为 ${JSON.stringify([...replicaProductFacts(job.product.sellingPoints), ""])}，只能选一个，禁止用分号或逗号拼接卖点。replace/keep 的格式只用 {"shotNumber":2,"dialogue":"","onScreenText":""}，省略 director 字段。`,
        "同一版避免每镜重复一种景别、运镜或同一卖点；复杂单镜多动作和跨场景转场不可执行。连续性靠开始/结束状态和真实接触维持；儿童商品不默认灰调，色调由商品外观、受众与场景说明。没有口播的镜头可留空，不能为填满字数写口号。",
        "明确区分【已给事实】与【拟拍动作】：主张及口播只陈述 facts 支持的属性；具体几步完成、能否徒手、是否复位、防滑/舒适/安全等结果未给就不能断言。动作可提出待确认的拍摄安排，但不能先承诺效果再把核实放进 missing。缺操作方法时拍已知部件的识别和可见细节，不编操作教程。",
        "比较版本时优先用不同真实证据、不同选购问题或不同视觉组织，例如一个解释结构、另一个展示使用情境；不能把同一动作换成两套同义台词。rationale 必须点名目标平台、对应一条平台建议、说明所选拍法如何利用可改镜头，并指出一个不适合的备选拍法。输出前逐项检查 strategy 与实际 lines 是否一致。",
        '只输出 JSON：{"plans":[{"angle":"切入角度","strategy":{"audience":"","insight":"","proposition":"","hook":"","method":"demo","narrative":"howto","rationale":"","visual":"","sound":"","cta":"","missing":[]},"lines":[{"shotNumber":1,"dialogue":"","onScreenText":"","director":{"beat":"demo","framing":"close","camera":"locked","transition":"cut","purpose":"","start":"","action":"","end":"","lighting":"","evidence":"","sound":""}}]}]}。strategy 文本各不超过400字；purpose/start/end/lighting各200字，action300字，evidence200字，sound120字，画面字120字。画面字留给剪辑，不要求视频模型生成。',
    ].join("\n");
}

export function parseRemakeDirectorPlans(text: string, job: RemakeJob, meta: { model: string; createdAt: string; idPrefix: string; expectedCount?: number }): RemakeDirectorPlan[] {
    const kept = job.shots.filter((shot) => shot.treatment !== "skip");
    const facts = replicaProductFacts(job.product.sellingPoints);
    for (const candidate of jsonCandidates(text)) {
        if (!Array.isArray(candidate.plans)) continue;
        const plans = candidate.plans.flatMap((raw, index): RemakeDirectorPlan[] => {
            if (!raw || typeof raw !== "object") return [];
            const strategy = readReplicaStrategy(raw.strategy);
            if (!strategy || typeof raw.angle !== "string" || !raw.angle.trim() || raw.angle.length > 80 || !Array.isArray(raw.lines) || raw.lines.length !== kept.length) return [];
            if (job.campaign?.style && job.campaign.style !== "auto" && strategy.method !== job.campaign.style) return [];
            if (job.campaign?.narrative && job.campaign.narrative !== "auto" && strategy.narrative !== job.campaign.narrative) return [];
            const seen = new Set<number>();
            const lines: RemakeDirectorPlan["lines"] = [];
            for (const line of raw.lines) {
                const shot = kept.find((item) => item.index === line?.shotNumber);
                if (!shot || seen.has(shot.index) || typeof line.dialogue !== "string" || [...line.dialogue].length > 300 || typeof line.onScreenText !== "string" || [...line.onScreenText].length > 120 || "treatment" in line) return [];
                if ((job.audio === "mute" || job.audio === "original") && line.dialogue.trim()) return [];
                seen.add(shot.index);
                if (shot.treatment !== "keep" && [...line.dialogue.replace(/\s/g, "")].length > remakeDialogueBudget(shot, job.language)) return [];
                const director = readReplicaDirection(line.director);
                if (shot.treatment !== "remake" && line.director != null && !(typeof line.director === "object" && !Array.isArray(line.director) && Object.keys(line.director).length === 0)) return [];
                if (shot.treatment === "remake") {
                    if (!director?.action || !director.purpose || !director.start || !director.end || !director.lighting) return [];
                    if ((director.beat === "proof" && !director.evidence) || (director.evidence && !facts.includes(director.evidence))) return [];
                    if (["action", "evidence", "sound", "purpose", "start", "end", "lighting"].some((key) => typeof line.director[key] !== "string" || [...line.director[key]].length > ({ action: 300, evidence: 200, sound: 120 }[key] || 200))) return [];
                }
                lines.push({
                    shotNumber: shot.index,
                    dialogue: shot.treatment === "keep" ? "" : line.dialogue.trim(),
                    onScreenText: shot.treatment === "keep" ? "" : line.onScreenText.trim(),
                    ...(shot.treatment === "remake" && director ? { director } : {}),
                });
            }
            return [{ id: `${meta.idPrefix}-${index + 1}`, angle: raw.angle.trim(), strategy, lines, model: meta.model, createdAt: meta.createdAt, input: remakeDirectorInput(job) }];
        });
        if (plans.length && (!meta.expectedCount || plans.length === meta.expectedCount)) return plans.slice(0, 3);
    }
    throw new Error("导演策划不完整：须包含全片策略、全部保留镜头、重拍镜头的动作始末及真实证明依据，且口播不超时；原方案保留。");
}

export function applyRemakeDirectorPlan(job: RemakeJob, plan: RemakeDirectorPlan): RemakeJob {
    if (plan.input !== remakeDirectorInput(job)) throw new Error("商品、策略设置或镜头做法已变化，请重新策划后再选用");
    return {
        ...job,
        activeDirectorPlanId: plan.id,
        shots: job.shots.map((shot) => {
            const line = plan.lines.find((item) => item.shotNumber === shot.index);
            if (!line || shot.treatment === "keep" || shot.treatment === "skip") return shot;
            return { ...shot, ...(job.audio === "rewrite" || job.audio === "voice" ? { dialogue: line.dialogue } : {}), ...(shot.treatment === "remake" ? { onScreenText: line.onScreenText, director: line.director } : {}) };
        }),
    };
}

export function readRemakeDirectorPlans(value: unknown, job: RemakeJob): RemakeDirectorPlan[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 3).flatMap((raw): RemakeDirectorPlan[] => {
        if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || typeof raw.input !== "string") return [];
        try {
            const [product, campaign, people, models, backgrounds, audio, language, note, shots, sourceSummary = job.sourceSummary] = JSON.parse(raw.input);
            const snapshot = { ...job, product, campaign, people, models, backgrounds, audio, language, note, shots, sourceSummary };
            const plan = parseRemakeDirectorPlans(JSON.stringify({ plans: [raw] }), snapshot, { model: String(raw.model || ""), createdAt: String(raw.createdAt || ""), idPrefix: "stored" })[0];
            return [{ ...plan, id: raw.id, input: raw.input }];
        } catch {
            return [];
        }
    });
}
