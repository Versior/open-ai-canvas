import type { StudioPlannedScreen } from "./types";

type Screen = Pick<StudioPlannedScreen, "role" | "purchaseQuestion" | "purpose" | "displayContent" | "visual" | "visualBeat" | "visualFocus" | "elements" | "evidenceRefs" | "noText">;

type Match = { field: "purpose" | "visualBeat" | "visualFocus" | "visual"; reason: string; strength: number };
type Repeat = Omit<Match, "strength"> & { index: number; previousIndex: number };

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
    hold: /手托|托住|托起|托着|捧住|捧起|捧着|手持|握住|握持|握着|手握/u,
    extract: /抽取|抽出|拉出|拉起/u,
    press: /按住|按下|按压|点按/u,
    turn: /旋转|转动|拧动/u,
};

function handAction(beat: string, content: string) {
    const twoHands = /双手|两只手|两手|左手[^。；]{0,60}右手|一只手[^。；]{0,60}另一只手/u.test(beat);
    const hands = twoHands ? "two" : /手托|手指|指尖|手持|一只手|单手/u.test(beat) ? "one" : "";
    if (!hands) return "";
    const action = Object.entries(HAND_ACTIONS).find(([, pattern]) => pattern.test(beat))?.[0] || (twoHands && HAND_ACTIONS.input.test(content) ? "input" : "");
    return action ? `${hands}:${action}` : "";
}

function screenSignals(screen: Screen) {
    const question = screen.purchaseQuestion || screen.purpose;
    const content = screen.displayContent || screen.visual;
    const beat = screen.visualBeat || "";
    const focus = screen.visualFocus || "";
    return {
        question: compact(question),
        questionTerms: terms(question),
        content: compact(content),
        contentTerms: terms(content),
        beat: compact(beat),
        beatTerms: terms(beat),
        focus: compact(focus),
        focusTerms: terms(focus),
        evidence: new Set(screen.evidenceRefs),
        handAction: handAction(beat, content),
        descriptiveOnly: Boolean(screen.noText || screen.role === "detail-hero" || screen.role === "detail-closing"),
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
    const similarQuestion = (questions.shared >= 3 && questions.score >= 0.58) || (sameEvidence && evidence.shared >= 2 && questions.shared >= 2 && (relatedFocus || exhibits.score >= 0.35));
    const content: Match | undefined = sameQuestion ? { field: "purpose", reason: "购买问题重复", strength: 2 } : similarQuestion ? { field: "purpose", reason: "购买问题相近", strength: 1 } : undefined;
    if (sameLayout) return { content };

    const beats = overlap(current.beatTerms, prior.beatTerms);
    const sharedAction = current.handAction && current.handAction === prior.handAction && ((beats.shared >= 3 && beats.score >= 0.32) || (current.handAction === "two:input" && evidence.shared >= 2));
    const repeatedExhibit = !current.descriptiveOnly && !prior.descriptiveOnly && current.content && current.content === prior.content && current.exhibitFocus === prior.exhibitFocus && ((!current.evidence.size && !prior.evidence.size) || sameEvidence);
    const visual: Match | undefined =
        current.beat && current.beat === prior.beat
            ? { field: "visualBeat", reason: "画面主线重复", strength: 5 }
            : repeatedExhibit
              ? { field: "visual", reason: "画面内容和证据均重复", strength: 4 }
              : sharedAction || (beats.shared >= 3 && beats.score >= 0.52)
                ? { field: "visualBeat", reason: "画面主线相近", strength: 3 }
                : current.focus && current.focus === prior.focus
                  ? { field: "visualFocus", reason: "视觉重点重复", strength: 2 }
                  : undefined;
    return { content, visual };
}

export function studioDetailRepeats(screens: readonly Screen[], sameLayout = false): Repeat[] {
    const signals = screens.map(screenSignals);
    return signals.flatMap((current, index) => {
        const strongest: { content?: Match & { previousIndex: number }; visual?: Match & { previousIndex: number } } = {};
        for (let previousIndex = 0; previousIndex < index; previousIndex++) {
            const matches = compare(current, signals[previousIndex], sameLayout);
            for (const kind of ["content", "visual"] as const) {
                const match = matches[kind];
                if (match && match.strength > (strongest[kind]?.strength || 0)) strongest[kind] = { ...match, previousIndex };
            }
        }
        return Object.values(strongest).map(({ field, reason, previousIndex }) => ({ index, previousIndex, field, reason }));
    });
}
