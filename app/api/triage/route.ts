import { experimental_evaluate as evaluate } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { buildDecision } from "@/lib/triage";

/** 消息长度上限，防止异常输入直烧 Gateway 费用 */
const MAX_MESSAGE_LENGTH = 2000;

export async function POST(req: NextRequest) {
    try {
        const body: unknown = await req.json();
        const message = (body as { message?: unknown } | null)?.message;

        if (typeof message !== "string" || message.length === 0) {
            return NextResponse.json(
                { error: "请输入售后消息" },
                { status: 400 },
            );
        }

        if (message.length > MAX_MESSAGE_LENGTH) {
            return NextResponse.json(
                {
                    error: `消息过长（${message.length} 字），上限 ${MAX_MESSAGE_LENGTH} 字`,
                },
                { status: 400 },
            );
        }

        const startedAt = performance.now();

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
                    instructions:
                        "顾客是否表达了强烈不满、威胁差评或投诉？",
                },
            },
            providerOptions: {
                gateway: {
                    zeroDataRetention: false, // Hobby 计划必须设为 false
                },
            },
        });

        const latencyMs = Math.round(performance.now() - startedAt);
        const decision = buildDecision(result.answers);

        // TypeSafe 特有的置信度统计（按问题 ID 分键，区别于选项概率分布）
        const typesafeMeta = result.providerMetadata?.typesafe as
            | { confidence?: Record<string, number> }
            | undefined;

        return NextResponse.json({
            success: true,
            answers: result.answers,
            decision,
            confidence: typesafeMeta?.confidence,
            meta: {
                latencyMs,
                model: result.response.modelId,
                responseId: result.response.id,
                usage: result.usage,
            },
        });
    } catch (error: unknown) {
        const messageText =
            error instanceof Error ? error.message : "分析失败，请稍后重试";
        console.error("Triage API Error:", error);
        return NextResponse.json({ error: messageText }, { status: 500 });
    }
}
