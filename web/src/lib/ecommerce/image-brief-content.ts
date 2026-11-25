const GENERATED_NO_COPY =
    /^(?:全屏无字|无字(?:摄影|构图|画面|成品)?|(?:全部|整屏)?(?:仅|只)保留商品(?:本身|自带|原有)(?:的)?(?:标识|印字|印刷|Logo))$|(?:不(?:要|得|允许)?\s*(?:添加|放|写|出现|生成|加|排(?:入)?)|禁(?:止|用)|去掉)\s*(?:任何|一切|所有|新增|额外)?\s*(?:文字|文案|标题|标语|说明文字)(?!区|位置|区域)|(?:做成|采用|交付|保持)\s*(?:纯)?无字|\b(?:text[- ]free|no (?:text|copy|captions?|typography))\b/i;
const GENERATED_TYPE_LAYOUT =
    /^(?:内容版式|本屏构图|信息元素|最终文案|固定排版|成品文案)[「『【（(：:]|(?:固定|预设|统一)(?:的)?\s*(?:文字区|标题框|版式|排版|字体|字号|\d+\s*(?:个|张|列)?(?:卡片|徽章|标签|图标))|(?:左文右图|右文左图|左图右文|右图左文|上文下图|上图下文)|(?:左上|右上|左下|右下|左侧|右侧|顶部|底部|居中)\s*(?:保留|留出|放置?|排入|排布)?\s*(?:约[一二三四五六七八九十\d%％成]+\s*)?(?:固定)?(?:文字区|字块|短?标题|副标题|文案)|\b(?:fixed (?:text area|layout|font)|text (?:on the|at the) (?:left|right|top|bottom))\b/i;

const LEGACY_DETAIL_COPY_DIRECTION =
    /^(?:短文案信息点\s*(?:围绕|[：:])|短文案只(?:点明|讲|描述|说明|写|说|作)|画面明确标注「[^」]+」$|不添加(?:任何)?图内(?:文字|文案)$|(?:图内文字|短标题|版式安排)\s*[：:])|^(?:上方|下方|左侧|右侧|顶部|底部)\s*(?:约?\s*(?:[一二三四五六七八九十]+分之[一二三四五六七八九十]+|\d+(?:\.\d+)?[%％])\s*)?(?:预留|留出?)\s*(?:标题区|文字区|文案区)|(?:左上|右上|左下|右下|左侧|右侧|顶部|底部|居中)\s*[一二三四五六七八九十\d]+\s*行[^，,。；;]{0,6}(?:字块|文案|标题)|(?:文字|字块|文案|短?标题|副标题)\s*(?:放在?|排在?|置于|对齐|居于)\s*(?:左上|右上|左下|右下|左侧|右侧|顶部|底部|居中)/;

const DETAIL_PHOTO_ONLY = /^(?:(?:本屏|本图|画面中?)\s*)?(?:只|仅)(?:呈现|展示|保留)(?:商品|产品)(?:本体|本身)$|^(?:不(?:要)?(?:添加|加上|写入)|勿添加)(?:额外)?品牌、型号(?:或|和|及)参数(?:文字|文案|标注)$/;

const PLANNER_COPY_OR_LAYOUT =
    /^(?:(?:本屏|本图|建议|成品|营销|图内|最终)\s*)?(?:短文案|主标题|副标题|标题|标语|文案|排版|构图|光线|布光|配色|色板|字体|机位|镜头|特效|背景|装饰|字号)\s*[：:]|^(?:画面)?(?:上方|下方|左侧|右侧|顶部|底部|居中)\s*(?:出现|加上?|写上?|带有|放[置上]?|印[上有]|排[入列])\s*[^。；]{0,36}(?:字样|字|标语|文案|标题|标签)(?!的)/i;
const EMBEDDED_COPY_DIRECTIVE = /(?:短文案|最终文案|图内文案|主标题|副标题|标语)\s*[：:]/i;
const REVIEW_NOTE = /^(?:(?:图中|照片中|画面中|实拍中|原图中)?(?:没有拍到|未见|没(?:有)?看(?:到|清)|尚未(?:确认|核实)|未(?:确认|核实|提供)|待(?:核实|确认))|(?:核对|核实|核验|复核)备注|(?:图中|照片中|画面中)?到手(?:清单)?\s*[:：])/;
const REVIEW_OBSERVATION = /(?:没有拍到|未见|没(?:有)?看(?:到|清)|尚未(?:确认|核实)|未(?:确认|核实|提供|出现)|待(?:核实|确认)|图中到手|到手清单)/;
const CONTENT_CLAUSES = /(?:「[^」\r\n]*」|『[^』\r\n]*』|“[^”\r\n]*”|‘[^’\r\n]*’|"[^"\r\n]*"|[^，,。；;！!？?\r\n])+[，,。；;！!？?]?/gu;

/**
 * 策划字段可以描述“画面要看见什么”，但不能把图片模型的文案草稿、
 * 字体位置或复核备注伪装成商品视觉事实。模型自己负责最后的文字和排版。
 */
function stripPlannerExecution(text: string) {
    return text
        .replace(/(?:^|[。；;\n])\s*(?:短文案|最终文案|图内文案|主标题|副标题|标语)\s*[：:][\s\S]*?(?=$|[。；;\n])/gi, "")
        .replace(/(?:^|[。；;\n])\s*(?:上方|下方|左侧|右侧|顶部|底部|居中)\s*(?:出现|加上?|写上?|带有|放[置上]?|印[上有]|排[入列])\s*[^。；;\n]*(?:字样|文字|标题|文案)[^。；;\n]*/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function stripPlannerExecutionClause(value: string): string {
    const clause = value.trim();
    if (!clause) return "";
    const sentences = clause.match(/[^。；;！!？?]+[。；;！!？?]?/g) || [clause];
    if (sentences.length > 1) {
        return sentences
            .map((sentence) => stripPlannerExecutionClause(sentence))
            .filter(Boolean)
            .join("")
            .trim();
    }
    // 规划模型可能把执行指令接在商品描述后面，或把“短文案”写成带引号的半句。
    // 引号里的原始包装印字仍然是商品事实，不能因为命中关键词就删除整段。
    const outsideQuotes = clause.replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"]*"/gu, "「原文」");
    const normalized = outsideQuotes.replace(/[，,。；;！!？?]+$/g, "").trim();
    if (GENERATED_NO_COPY.test(normalized) || GENERATED_TYPE_LAYOUT.test(normalized) || DETAIL_PHOTO_ONLY.test(normalized)) return "";
    if (LEGACY_DETAIL_COPY_DIRECTION.test(normalized) || PLANNER_COPY_OR_LAYOUT.test(normalized) || EMBEDDED_COPY_DIRECTIVE.test(normalized)) return "";
    return clause;
}

export function commerceImageBriefContent(value: string | undefined, contentOnly = false): string {
    const text = stripPlannerExecution(value?.trim() || "");
    const parts = contentOnly ? text.match(CONTENT_CLAUSES) || [] : text.split(/(?<=[，,。；;！!？?])|\r?\n/);
    const content = parts
        .map((part) => part.trim())
        .map((part) => (contentOnly ? stripPlannerExecutionClause(part) : part))
        .filter((part) => {
            if (!part) return false;
            if (!contentOnly) return true;
            const instruction = part.replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"]*"/gu, "「原文」");
            return !REVIEW_OBSERVATION.test(instruction) && !DETAIL_PHOTO_ONLY.test(instruction) && !REVIEW_NOTE.test(instruction);
        });
    if (content.length === parts.length) return text;
    return content
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n")
        .replace(/[，,；;]$/, "");
}
