import { experimental_evaluate as evaluate } from "ai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const message = body.message;

        if (!message || typeof message !== "string") {
            return NextResponse.json(
                { error: "请输入售后消息" },
                { status: 400 },
            );
        }

        const result = await evaluate({
            model: "typesafe-ai/jev",
            state: `电商售后消息：\n「${message}」\n渠道：在线客服\n店铺：示例女装店`,
            questions: {
                category: {
                    type: "choice",
                    instructions: "这条售后消息应该路由到哪个处理组？",
                    criteria: {
                        logistics: "物流、签收、快递丢失/延迟/未收到",
                        return_refund: "退货、换货、退款",
                        product_quality: "质量问题、描述不符、瑕疵、尺码问题",
                        payment: "扣款、支付、发票异常",
                        other: "无法明确归类或其他",
                    },
                },
                urgency: {
                    type: "score",
                    instructions: "这条消息的紧急/严重程度如何？",
                    criteria: [
                        "普通咨询，不着急",
                        "有点着急或轻微不便",
                        "明显不满，要求尽快处理",
                        "强烈投诉、情绪激烈或威胁",
                    ],
                },
                wants_refund: {
                    type: "boolean",
                    instructions: "顾客是否明确要求退款或退货？",
                },
                angry: {
                    type: "boolean",
                    instructions: "顾客是否表达了强烈不满、威胁差评或投诉？",
                },
            },
            providerOptions: {
                gateway: {
                    zeroDataRetention: false, // Hobby 计划必须设为 false
                },
            },
        });

        const answers = result.answers;

        // 决策逻辑
        let finalDecision = "正常路由处理";
        let priority = "普通";
        let reason = "";

        const urgencyScore = answers.urgency?.score ?? 0;
        const angryProb = answers.angry?.probability ?? 0;
        const refundProb = answers.wants_refund?.probability ?? 0;
        const category = answers.category?.choice ?? "other";
        const topProb = answers.category?.probabilities?.[category] ?? 0;

        if (urgencyScore >= 2.5 || angryProb > 0.7) {
            priority = "高优";
            finalDecision = "建议立即转人工处理";
            reason = `紧急程度较高（${urgencyScore.toFixed(2)}）或强烈不满概率 ${(angryProb * 100).toFixed(0)}%，建议优先人工介入。`;
        } else if (category === "return_refund" && refundProb > 0.65) {
            finalDecision = "进入退换货/退款流程";
            priority = refundProb > 0.85 ? "较高" : "普通";
            reason = `明确倾向退款/退货（概率 ${(refundProb * 100).toFixed(0)}%），路由至 return_refund 流程。`;
        } else if (category === "logistics") {
            finalDecision = "路由到物流组查询";
            reason = `主要问题集中在物流相关（置信度 ${(topProb * 100).toFixed(0)}%）。`;
        } else if (category === "product_quality") {
            finalDecision = "路由到质量问题处理";
            reason = `主要涉及质量/尺码问题（置信度 ${(topProb * 100).toFixed(0)}%）。`;
        } else {
            reason = `综合路由分组「${category}」（${(topProb * 100).toFixed(0)}%）、紧急程度 ${urgencyScore.toFixed(2)}、退款意愿 ${(refundProb * 100).toFixed(0)}%，按正常流程处理。`;
        }

        return NextResponse.json({
            success: true,
            answers,
            decision: {
                final: finalDecision,
                priority,
                category,
                reason,
            },
            usage: result.usage,
        });
    } catch (error: any) {
        console.error("Triage API Error:", error);
        return NextResponse.json(
            { error: error.message || "分析失败，请稍后重试" },
            { status: 500 },
        );
    }
}
