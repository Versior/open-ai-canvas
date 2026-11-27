import type { StudioPlannedScreen } from "./types";

type Screen = Pick<StudioPlannedScreen, "role" | "purchaseQuestion" | "purpose" | "displayContent" | "visual" | "visualBeat" | "visualFocus" | "elements" | "evidenceRefs" | "detailSource">;

type Match = { field: "purpose" | "visualBeat" | "visualFocus" | "visual"; reason: string; strength: number; replaceEarlier?: true; recap?: true; cluster?: true };
type Repeat = Omit<Match, "strength" | "replaceEarlier"> & { index: number; previousIndex: number; replaceIndex?: number };

const filler = new Set(["商品", "产品", "画面", "主体", "本屏", "展示", "呈现", "是否", "什么", "看到", "看清", "怎么", "如何", "同时"]);
const compact = (value: string) =>
    value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\p{P}]/gu, "");

function terms(value: string) {
    const terms =
        value
            .normalize("NFKC")
            .toLowerCase()
            .match(/\p{Script=Han}+|[a-z0-9]+/gu) || [];
    const tokens = terms.flatMap((term) => (/^\p{Script=Han}/u.test(term) ? Array.from({ length: Math.max(0, term.length - 1) }, (_, position) => term.slice(position, position + 2)) : [term]));
    return new Set(tokens.filter((token) => token.length > 1 && !filler.has(token)));
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>) {
    const shared = [...left].filter((key) => right.has(key)).length;
    return { shared, score: shared / (left.size + right.size - shared || 1) };
}

const HAND_ACTIONS = {
    input: /打字|键入|输入/u,
    extract: /抽取|抽出|拉出|拉起/u,
    press: /按住|按下|按压|点按/u,
    turn: /旋转|转动|拧动/u,
    slide: /拨动|拨上|拨下|滑动(?!开关|按钮|控件)/u,
    hold: /手托|托住|托起|托着|捧住|捧起|捧着|手持|握住|握持|握着|手握|手掌包住/u,
};

function handAction(beat: string, content: string) {
    const twoHands = /双手|两只手|两手|左手[^。；]{0,60}右手|一只手[^。；]{0,60}另一只手/u.test(beat);
    const hands = twoHands ? "two" : /手托|手指|指尖|手持|一只手|单手|握持|手掌/u.test(beat) ? "one" : "";
    if (!hands) return "";
    const action = Object.entries(HAND_ACTIONS).find(([, pattern]) => pattern.test(beat))?.[0] || (twoHands && HAND_ACTIONS.input.test(content) ? "input" : "");
    return action ? `${hands}:${action}` : "";
}

const controlTerms = /开关|拨钮|拨杆|滑钮|滑块|电源键|旋钮/gu;
const airOutlet = /出风口|风口|风筒/u;
const productMark = /品牌|商标|印字|标识|印刷字样|logo/iu;
const completeItem = /整只|整条|整件|整块/u;
const uncutItem = /切开|切好|切片|切段|切成|未切|分切/u;
const completeDisplay = /整只|整条|整件|整块|单只完整|完整个体/u;
const dryingObject = /头发|湿发|发丝|发根|发束|长发|短发|吹发|刘海|发区/u;
const dryingAppliance = /吹发|吹风机|出风口|风口|风筒/u;

function purchaseIntent(question: string, content: string, controls: ReadonlySet<string>) {
    const exhibit = `${question} ${content}`;
    const operatesControl = controls.size && /拨动|怎么拨|往哪[^，。？]{0,3}拨|按下|点按|按压|拧动|转动|触达|够到|碰到|拨到/u.test(question);
    if (operatesControl) return "control";
    if (/[、，,]/u.test(question) && /排布|排列|分区/u.test(question) && /依次|列出|从上到下|从左到右|由上至下/u.test(content)) return "feature-inventory";
    if (/(?:收纳|放得下|放不下|占(?:不占|多少|多大)?地方|占(?:用|不占)?空间|占地)/u.test(question)) return "storage";
    if (/(?:平放|侧放|摆放|放在|摆在|搁在)/u.test(question) && /垂[落到向]|朝(?:向|哪)|怎么摆/u.test(exhibit) && /电源线|线缆|走线|分别朝/u.test(question)) return "placement";
    if (/斜插|直角相接|怎么连接|如何接合/u.test(question) && /连接处|接合处|(?:直角|倾斜)连接/u.test(content)) return "part-joint";
    if (controls.size && (/在哪|在[^，。？]{0,10}(?:哪个位置|什么位置|哪一侧)|怎么用|如何操作/u.test(question) || /(?:拇指|手指|指尖)[^，。；]{0,8}(?:靠近|接触|搭在|落在)[^，。；]{0,12}(?:开关|滑块|旋钮|拨钮|电源键)/u.test(content))) return "control";
    if (dryingObject.test(exhibit) && dryingAppliance.test(exhibit) && !/结构|温度|温控|风量|档位|多久|能否吹干/u.test(question)) {
        return /什么时候|何时|什么时机|哪个时机/u.test(question) ? "drying-occasion" : "drying-motion";
    }
    if ((HAND_ACTIONS.hold.test(question) || /[竖横斜]握/u.test(question)) && airOutlet.test(question) && /朝(?:向|哪)|向(?:前|哪)|方向|指向|对准/u.test(question) && !/比例|尺度|尺寸|触达/u.test(question)) return "drying-pose";
    if (/(?:出风口|风口|格栅)/u.test(question) && /(?:格栅|位置|方向|哪一?[端侧]|结构|形状|完整看到)/u.test(question) && !/(?:使用|头发|吹发|发丝|发束|清理|清洁|拆|安装|温度|风量|配件|如何用)/u.test(question)) return "outlet-form";
    if (productMark.test(question) && /哪|哪里|什么|位置|怎么印|长什么样/u.test(question) && !/防伪|真伪|鉴别|型号|规格|版本|选款|批次/u.test(question)) return "marking";
    const mentionsColors = question.match(/(?:[深浅](?:(?:薄荷)?[红橙黄绿青蓝紫粉]|色)|[红橙黄绿青蓝紫粉白黑灰棕]色)/gu) || [];
    const asksAboutColor = /(?:配色|分色|色块|同色|实物颜色|是什么颜色)/u.test(question) || (mentionsColors.length >= 2 && /(?:分布|分别|分界|各在哪|放在.*(?:效果|感觉))/u.test(question));
    if (asksAboutColor && !/(?:可选|可挑|哪几款|不同款|选哪|色号|(?:怎么|如何|怎样)(?:靠|沿|用|通过)|按下|按压|拆装|拆卸|卡扣)/u.test(question)) return "body-colors";
    const describesWhole = uncutItem.test(exhibit) || /连(?:在一起|成一体|为一体|着)|(?:完整|保持)(?:相连|连接)/u.test(content);
    if ((completeItem.test(question) || /完整度/u.test(question)) && describesWhole && !/(?:怎么|怎样|如何)(?:切|清洗|冲洗|拆|分)/u.test(question)) return "whole-form";
    if (/(?:外壳|外包|壳体|筒身|风筒|瓶身|袋身)/u.test(question) && /轮廓|圆角|圆弧|圆筒|方角|方盒|收口/u.test(question) && !/出风口|开关|尺寸|手柄|开盖|用途|怎么用/u.test(question)) return "shell-form";
    return "";
}

function screenSignals(screen: Screen) {
    const question = screen.purchaseQuestion || screen.purpose;
    const content = screen.displayContent || screen.visual;
    const beat = screen.visualBeat || "";
    const focus = screen.visualFocus || "";
    const controls = new Set(screen.role === "detail-hero" ? [] : question.match(controlTerms) || []);
    const action = handAction(beat, content);
    const hero = screen.role === "detail-hero";
    const closing = screen.role === "detail-closing";
    const facts = (screen.evidenceRefs || []).filter((id) => !id.startsWith("photo:"));
    const intent = purchaseIntent(question, content, controls);
    return {
        region: screen.detailSource,
        question: compact(question),
        questionTerms: terms(question),
        controls,
        intent,
        content: compact(content),
        contentTerms: terms(content),
        beat: compact(beat),
        beatTerms: terms(beat),
        focus: compact(focus),
        focusTerms: terms(focus),
        gripFocus: /手柄|握柄/u.test(`${beat} ${focus}`),
        evidence: new Set(facts),
        primaryEvidence: facts[0],
        showsWhole: completeDisplay.test(content) && !/(?:未|不)(?:能|是)整/u.test(content),
        handAction: action,
        heldWhole: /整只|整条|整件|整块|整机|完整(?:外形|轮廓)|整体(?:轮廓|外形|被手)/u.test(`${content} ${beat} ${focus}`) && (!action || action.endsWith(":hold")) && HAND_ACTIONS.hold.test(`${content} ${beat}`),
        hero,
        closing,
        descriptiveOnly: hero || closing,
        recap: (intent === "feature-inventory" && !hero && facts.length >= 2) || (closing && /(?:与|和|对应)前述|回顾|各屏为同一|(?:已经|已)展示|(?:外观|画面|页面)[^？?。]{0,18}(?:对得上|一致)/u.test(`${question} ${content}`)),
        exhibitFocus: compact(focus || screen.elements),
    };
}

function compare(current: ReturnType<typeof screenSignals>, prior: ReturnType<typeof screenSignals>, sameLayout: boolean): { content?: Match; visual?: Match } {
    const evidence = overlap(current.evidence, prior.evidence);
    const questions = overlap(current.questionTerms, prior.questionTerms);
    const exhibits = overlap(current.contentTerms, prior.contentTerms);
    const focus = overlap(current.focusTerms, prior.focusTerms);
    const sameEvidence = evidence.score === 1;
    const relatedFocus = focus.shared >= 4 && focus.score >= 0.15;
    const sameQuestion = current.question && current.question === prior.question;
    const repeatControl = current.intent === "control" && evidence.shared > 0 && [...current.controls].some((control) => prior.controls.has(control)) && (sameEvidence || exhibits.shared >= 2);
    const repeatUse = !current.descriptiveOnly && !prior.descriptiveOnly && current.intent === "drying-motion";
    const repeatColors = !current.descriptiveOnly && !prior.descriptiveOnly && current.intent === "body-colors" && (exhibits.shared >= 2 || evidence.shared >= 1);
    const repeatPlacement = current.intent === "placement" && focus.shared >= 2;
    const repeatWholeForm = current.intent === "whole-form" && evidence.shared > 0;
    const repeatShell = current.intent === "shell-form" && Boolean(current.primaryEvidence && current.primaryEvidence === prior.primaryEvidence);
    const repeatOutlet = current.intent === "outlet-form" && !prior.hero && evidence.shared > 0;
    const sameIntent =
        current.intent && current.intent === prior.intent && (relatedFocus || (exhibits.shared >= 3 && exhibits.score >= 0.12) || repeatControl || repeatPlacement || repeatUse || repeatColors || repeatWholeForm || repeatShell || repeatOutlet);
    const wholeAlreadyShown = current.intent === "whole-form" && prior.hero && prior.showsWhole && evidence.shared >= 2;
    const incompleteUse = (intent: string) => intent === "drying-pose" || intent === "drying-occasion";
    const repeatedUseSetup = !current.descriptiveOnly && !prior.descriptiveOnly && ((incompleteUse(current.intent) && prior.intent === "drying-motion") || (incompleteUse(prior.intent) && current.intent === "drying-motion"));
    const coveredMark = current.intent === "marking" && productMark.test(prior.content + prior.focus) && ((current.evidence.size > 0 && evidence.shared === current.evidence.size) || (exhibits.shared >= 4 && exhibits.score >= 0.22));
    const closingMark = current.closing && prior.hero && current.intent === "marking";
    const coveredFocus = [...current.focusTerms].filter((term) => prior.focusTerms.has(term) || prior.contentTerms.has(term)).length;
    const samePrimaryExhibit =
        !current.descriptiveOnly &&
        current.primaryEvidence &&
        current.primaryEvidence === prior.primaryEvidence &&
        evidence.shared === current.evidence.size &&
        coveredFocus >= Math.max(4, current.focusTerms.size * 0.6) &&
        (!current.intent || current.intent === prior.intent);
    const similarQuestion = sameIntent || wholeAlreadyShown || samePrimaryExhibit || (questions.shared >= 3 && questions.score >= 0.58) || (sameEvidence && evidence.shared >= 2 && questions.shared >= 2 && (relatedFocus || exhibits.score >= 0.35));
    const content: Match | undefined = repeatedUseSetup
        ? { field: "purpose", reason: "已由实际用法交代，无需另占一屏", strength: 4, ...(incompleteUse(prior.intent) ? { replaceEarlier: true } : {}) }
        : sameQuestion
          ? { field: "purpose", reason: "购买问题重复", strength: 3 }
          : coveredMark
            ? { field: "purpose", reason: "已展示过同一标识", strength: 2 }
            : closingMark
              ? { field: "purpose", reason: "的商品识别职责重叠，印字无需单独成屏", strength: 2 }
              : similarQuestion
                ? { field: "purpose", reason: "购买问题相近", strength: 1 }
                : undefined;
    if (sameLayout) return { content };

    const beats = overlap(current.beatTerms, prior.beatTerms);
    const sharedAction = current.handAction && current.handAction === prior.handAction && ((beats.shared >= 3 && beats.score >= 0.32) || (current.handAction === "two:input" && evidence.shared >= 2));
    const repeatedWholeHold = current.intent === "whole-form" && current.heldWhole && prior.heldWhole && evidence.shared > 0;
    const repeatedGrip =
        current.handAction === "one:hold" && prior.handAction === "one:hold" && evidence.shared >= 2 && current.gripFocus && prior.gripFocus && ![current.intent, prior.intent].some((intent) => intent === "control" || intent === "drying-motion");
    const repeatedExhibit = !current.descriptiveOnly && !prior.descriptiveOnly && current.content && current.content === prior.content && current.exhibitFocus === prior.exhibitFocus && ((!current.evidence.size && !prior.evidence.size) || sameEvidence);
    const visual: Match | undefined =
        current.beat && current.beat === prior.beat
            ? { field: "visualBeat", reason: "画面主线重复", strength: 5 }
            : repeatedExhibit
              ? { field: "visual", reason: "画面内容和证据均重复", strength: 4 }
              : repeatedWholeHold || sharedAction || repeatedGrip || (beats.shared >= 3 && beats.score >= 0.52)
                ? { field: "visualBeat", reason: "画面主线相近", strength: 3 }
                : current.focus && current.focus === prior.focus
                  ? { field: "visualFocus", reason: "视觉重点重复", strength: 2 }
                  : undefined;
    return { content, visual };
}

function staticDisplayPose(question: string, answer: string) {
    if (!/(?:怎么|怎样|如何)(?:摆(?:放)?|放(?:在|到)?一起|摆在一起|陈列|放置)[。？?！!]*$/u.test(question)) return;
    const poses = answer.split(/[，,。；;\n]/u).flatMap((clause) => {
        const part = clause.trim().match(/^([\p{Script=Han}]{2,10}?)(?:呈|保持)?(?:(横向|横放|横置)|(竖向|直立|竖放|竖置)|(?:朝|向)([内外上下左右前后]))$/u);
        return part ? [`${part[1]}:${part[2] ? "横" : part[3] ? "竖" : part[4]}`] : [];
    });
    return new Set(poses);
}

function crowdedSubjects(screens: readonly Screen[], signals: ReturnType<typeof screenSignals>[]) {
    const entries = screens.map((screen) => {
        const question = screen.purchaseQuestion || screen.purpose;
        const answer = screen.displayContent || screen.visual;
        const clause = question
            .split(/[，,；;：:]/u)
            .at(-1)!
            .replace(/^(?:这[根条个])/u, "");
        const newUse = /调节|调长|调短|收紧|放松|锁紧|扣合|拆卸|拆下|装上|安装|清洗|冲洗|更换|受力|打结|缠绕|收卷|长度|尺寸|刻度|材质|防滑面|纹理|标线|固定扣|定位槽/u.test(question);
        const subject = !newUse && /方向|哪[一两]?侧|哪边|往哪|怎么走|如何走|走向/u.test(clause) ? clause.match(/^([\p{Script=Han}a-z0-9]{2,12}?)(?:会|要|通常)?(?:从|往|朝|沿|经过|垂|怎么走|如何走|的走向)/u)?.[1] : undefined;
        const grip = newUse ? undefined : question.match(/(?:握|抓|拿|托)(?:在|住|着)?([\p{Script=Han}]{2,8}?)(?:的)?(?:哪一?段|哪个部位|什么位置|哪里|哪一?处)[？?]?$/u)?.[1];
        const decision = /预留|留出|测量|先量|量一下|确认.{0,5}(?:距离|空间|位置)/u.test(question);
        const origin = /引出|出来|起点|固定在哪|接在哪|接口在哪|连接点|连接处|从哪里接出/u.test(question);
        const placement = ["detail-scene", "detail-collocation", "detail-closing"].includes(screen.role) && !decision && !newUse ? staticDisplayPose(question, answer) : undefined;
        return { answer, question, subject: subject && answer.includes(subject) ? subject : undefined, grip, decision, origin, placement };
    });
    const result = new Map<number, { anchor: number; reason: string }>();
    for (const subject of new Set(entries.flatMap((item) => (item.subject ? [item.subject] : [])))) {
        const paths = entries.flatMap((item, index) => (item.subject === subject ? [index] : []));
        if (paths.length < 2) continue;
        const decision = entries.findIndex((item, index) => !signals[index].hero && item.decision && item.answer.includes(subject));
        const origin = entries.findIndex((item) => item.origin && item.question.includes(subject) && item.answer.includes(subject));
        if (decision < 0 && origin < 0) continue;
        const anchor = decision < 0 ? paths[0] : decision;
        const sameSubject = [...paths, decision, origin].filter((index) => index >= 0);
        for (const index of paths) {
            if (index === anchor || entries[index].origin || entries[index].decision) continue;
            if ([...signals[index].evidence].some((id) => !sameSubject.some((other) => other !== index && signals[other].evidence.has(id)))) continue;
            result.set(index, { anchor, reason: `反复展示${subject}的走向，没有新的动作或实物证据` });
        }
    }
    for (const [index, item] of entries.entries()) {
        const placement = item.placement;
        if (placement && placement.size >= 2) {
            const anchor = entries.findIndex((other, prior) => prior < index && other.placement && overlap(placement, other.placement).shared >= 2);
            if (anchor >= 0) result.set(index, { anchor, reason: "用相同的实物摆位回答陈列问题，只更换了周围物件" });
        }
        if (!item.grip || !item.answer.includes(item.grip) || !signals[index].evidence.size || signals[index].hero) continue;
        const supports = entries.flatMap((other, candidate) =>
            candidate !== index &&
            !signals[candidate].hero &&
            !other.subject &&
            !other.grip &&
            other.answer.includes(item.grip!) &&
            /(?:手|掌|指|单手|双手).{0,4}(?:握|托|抓|拿|持)|握持/u.test(other.question + other.answer) &&
            overlap(signals[index].evidence, signals[candidate].evidence).shared > 0
                ? [candidate]
                : [],
        );
        if (supports.length >= 2) result.set(index, { anchor: supports[0], reason: "握持位置已随其他实际用途和结构展示，没有新的动作" });
    }
    return result;
}

export function studioDetailRepeats(screens: readonly Screen[], sameLayout = false, involvingIndex?: number): Repeat[] {
    const signals = screens.map(screenSignals);
    const strongest = new Map<number, { content?: Repeat & { strength: number }; visual?: Repeat & { strength: number } }>();
    const record = (kind: "content" | "visual", match: Match, index: number, previousIndex: number) => {
        if (involvingIndex !== undefined && index !== involvingIndex && previousIndex !== involvingIndex) return;
        const target = match.replaceEarlier ? previousIndex : index;
        const row = strongest.get(target) || {};
        if (!row[kind] || match.strength > row[kind].strength) {
            row[kind] = { index, previousIndex, field: match.field, reason: match.reason, strength: match.strength, ...(match.replaceEarlier ? { replaceIndex: target } : {}), ...(match.recap ? { recap: true } : {}) };
            strongest.set(target, row);
        }
    };
    for (const [index, current] of signals.entries()) {
        const covered = new Set<string>();
        let recapSource = -1;
        let recapScore = 0;
        for (let previousIndex = 0; previousIndex < index; previousIndex++) {
            const prior = signals[previousIndex];
            const region = current.region;
            if (
                previousIndex + 1 === index &&
                prior.region?.framing === "locate" &&
                region &&
                !region.framing &&
                ["detail-closeup", "detail-material"].includes(screens[index].role) &&
                prior.question !== current.question &&
                prior.region.photo === region.photo &&
                prior.region.box.every((value, position) => value === region.box[position])
            )
                continue;
            if (current.recap && (current.intent !== "feature-inventory" || !prior.hero)) {
                prior.evidence.forEach((id) => covered.add(id));
                const evidence = overlap(current.evidence, prior.evidence);
                const score = evidence.shared + (current.intent === "feature-inventory" ? evidence.score : overlap(current.contentTerms, prior.contentTerms).score);
                if (score > recapScore) {
                    recapScore = score;
                    recapSource = previousIndex;
                }
            }
            const matches = compare(current, prior, sameLayout);
            for (const kind of ["content", "visual"] as const) {
                const match = matches[kind];
                if (match) record(kind, match, index, previousIndex);
            }
        }
        if (current.recap && recapSource >= 0 && recapScore >= (current.evidence.size ? 1 : 0.24) && [...current.evidence].every((id) => covered.has(id))) {
            const existing = strongest.get(index)?.content;
            if (existing) existing.recap = true;
            else record("content", { field: "purpose", reason: current.intent === "feature-inventory" ? "等前文内容重叠，只重列了已展示的部位" : "只回顾了已展示的答案", strength: 2, recap: true }, index, recapSource);
        }
    }
    for (const [target, { anchor, reason }] of crowdedSubjects(screens, signals)) {
        if (involvingIndex !== undefined && target !== involvingIndex) continue;
        const row = strongest.get(target) || {};
        row.content = { index: Math.max(target, anchor), previousIndex: Math.min(target, anchor), ...(target < anchor ? { replaceIndex: target } : {}), field: "purpose", reason, strength: 2, ...(row.content?.recap ? { recap: true } : {}), cluster: true };
        strongest.set(target, row);
    }
    return [...strongest.keys()]
        .sort((left, right) => left - right)
        .flatMap((index) => {
            const { content, visual } = strongest.get(index)!;
            return [content, visual].flatMap((entry) =>
                entry
                    ? [
                          {
                              index: entry.index,
                              previousIndex: entry.previousIndex,
                              field: entry.field,
                              reason: entry.reason,
                              ...(entry.replaceIndex === undefined ? {} : { replaceIndex: entry.replaceIndex }),
                              ...(entry.recap ? { recap: true } : {}),
                              ...(entry.cluster ? { cluster: true } : {}),
                          },
                      ]
                    : [],
            );
        });
}
