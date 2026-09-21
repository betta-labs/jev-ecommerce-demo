/**
 * 电商售后分流：确定性决策逻辑（纯函数，与模型调用解耦）。
 *
 * 模型（TypeSafe Jev）只负责「判断」——产出带概率的结构化 answers；
 * 本模块负责「决策」——把 answers 映射为可审计、可单测的路由结论。
 * 阈值均为演示用示例值，生产环境应基于自己的标注数据校准。
 */

export interface ChoiceAnswer {
    type: "choice";
    choice: string;
    probabilities?: Record<string, number>;
}

export interface ScoreAnswer {
    type: "score";
    score: number;
    probabilities?: Record<string, number>;
}

export interface BooleanAnswer {
    type: "boolean";
    /** 模型估计的 P(true)，非置信度 */
    probability: number;
}

export interface TriageAnswers {
    category?: ChoiceAnswer;
    urgency?: ScoreAnswer;
    wants_refund?: BooleanAnswer;
    angry?: BooleanAnswer;
}

export type TriagePriority = "高优" | "较高" | "普通";

export interface TriageDecision {
    /** 最终路由结论 */
    final: string;
    priority: TriagePriority;
    /** 模型判定的路由分组 */
    category: string;
    /** 人类可读的触发原因（含具体数值） */
    reason: string;
    /** 触发该决策的规则 ID，便于测试与前端标识 */
    rule: TriageRuleId;
}

export type TriageRuleId =
    | "urgent"
    | "low_confidence"
    | "refund_mismatch"
    | "refund_flow"
    | "logistics"
    | "product_quality"
    | "payment"
    | "normal";

export const CATEGORY_LABELS: Record<string, string> = {
    logistics: "物流",
    return_refund: "退换货",
    product_quality: "质量问题",
    payment: "支付/账单",
    other: "其他",
};

export const RULE_LABELS: Record<TriageRuleId, string> = {
    urgent: "紧急度 / 情绪优先",
    low_confidence: "置信度门控",
    refund_mismatch: "多问题交叉验证",
    refund_flow: "退换货流程",
    logistics: "类别路由",
    product_quality: "类别路由",
    payment: "类别路由",
    normal: "默认路由",
};

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** 自动路由的类别置信度门槛：低于此值不盲路由，转人工复核 */
const AUTO_ROUTE_CONFIDENCE = 0.4;
/** 退款意愿与类别判定的交叉验证阈值 */
const REFUND_MISMATCH_THRESHOLD = 0.8;

export function buildDecision(answers: TriageAnswers): TriageDecision {
    const urgencyScore = answers.urgency?.score ?? 0;
    const angryProb = answers.angry?.probability ?? 0;
    const refundProb = answers.wants_refund?.probability ?? 0;
    const category = answers.category?.choice ?? "other";
    const categoryLabel = CATEGORY_LABELS[category] ?? category;
    // 分布是可选的：无分布时不做置信度门控
    const topProb = answers.category?.probabilities?.[category] ?? 0;

    // 1. 高紧急或强烈不满：情绪优先于一切类别路由
    if (urgencyScore >= 2.5 || angryProb > 0.7) {
        return {
            rule: "urgent",
            final: "建议立即转人工处理",
            priority: "高优",
            category,
            reason: `紧急程度 ${urgencyScore.toFixed(2)}/3，强烈不满概率 ${pct(angryProb)}，建议优先人工介入。`,
        };
    }

    // 2. 置信度门控：类别概率过低时，宁可人工复核也不盲路由
    if (topProb > 0 && topProb < AUTO_ROUTE_CONFIDENCE) {
        return {
            rule: "low_confidence",
            final: "分类置信度不足，转人工复核",
            priority: "普通",
            category,
            reason: `路由分组「${categoryLabel}」置信度仅 ${pct(topProb)}，低于自动路由门槛 ${pct(AUTO_ROUTE_CONFIDENCE)}，不做盲目分流。`,
        };
    }

    // 3. 多问题交叉验证：明确要退款、但类别没判到退换货组
    if (refundProb > REFUND_MISMATCH_THRESHOLD && category !== "return_refund") {
        return {
            rule: "refund_mismatch",
            final: "转退换货组复核（退款意愿与类别不一致）",
            priority: "较高",
            category,
            reason: `退款意愿 ${pct(refundProb)}，但分类判为「${categoryLabel}」，两次独立判断不一致，转退换货组复核。`,
        };
    }

    // 4. 明确的退换货诉求
    if (category === "return_refund" && refundProb > 0.65) {
        return {
            rule: "refund_flow",
            final: "进入退换货/退款流程",
            priority: refundProb > 0.85 ? "较高" : "普通",
            category,
            reason: `明确倾向退款/退货（概率 ${pct(refundProb)}），路由至 return_refund 流程。`,
        };
    }

    if (category === "logistics") {
        return {
            rule: "logistics",
            final: "路由到物流组查询",
            priority: "普通",
            category,
            reason: `主要问题集中在物流相关（置信度 ${pct(topProb)}）。`,
        };
    }

    if (category === "product_quality") {
        return {
            rule: "product_quality",
            final: "路由到质量问题处理",
            priority: "普通",
            category,
            reason: `主要涉及质量/尺码问题（置信度 ${pct(topProb)}）。`,
        };
    }

    if (category === "payment") {
        return {
            rule: "payment",
            final: "路由到支付/账单组处理",
            priority: "普通",
            category,
            reason: `涉及扣款、支付或发票异常（置信度 ${pct(topProb)}）。`,
        };
    }

    return {
        rule: "normal",
        final: "正常路由处理",
        priority: "普通",
        category,
        reason: `综合路由分组「${category}」（${pct(topProb)}）、紧急程度 ${urgencyScore.toFixed(2)}、退款意愿 ${pct(refundProb)}，按正常流程处理。`,
    };
}
