# 电商售后智能分流 Demo

> 一个极简的 Next.js 应用：把一条顾客售后消息交给 **TypeSafe Jev** 评估模型，
> **一次调用并行产出 4 个带概率的结构化判断**，再用确定性业务规则合成最终的分流决策与优先级。

这不是一个聊天机器人，也不是一个「让 LLM 自由发挥写结论」的 Demo。它的重点是展示一种新的模型调用范式：
**用「评估（Evaluation）」代替「生成」——让模型输出可直接参与业务判断的 calibrated 结构化答案，而不是一段需要再解析的自然语言。**

---

## 它解决什么问题

电商客服每天收到大量售后消息，需要在几秒内判断：

- 这条该转给哪个组？（物流 / 退换货 / 质量问题 / 支付异常）
- 有多急？（普通咨询 → 强烈投诉）
- 是不是要退款？
- 是不是已经情绪失控、可能升级成投诉？

传统做法有两类，各有明显缺陷：

| 做法 | 问题 |
| --- | --- |
| 关键词 / 正则规则 | 覆盖率低，遇到「衣服有点问题，尺码好像不太对」这类模糊表达就失效 |
| 让 LLM 生成一段分析文本再正则抽取 | 输出不稳定、需要解析、拿不到置信度、无法按概率设阈值 |

本 Demo 的第三类做法：**一次 `evaluate()` 调用，同时问 4 个问题，直接拿到
choice（含各类别概率分布）、score（0–3 连续分）、boolean ×2（含概率）**，
业务侧的代码只做「读数字 + 比阈值」，不做文本解析。

---

## 核心机制：AI SDK 的 Evaluation API

关键代码在 `app/api/triage/route.ts`，调用的是 AI SDK 的实验性 `experimental_evaluate`：

```ts
import { experimental_evaluate as evaluate } from "ai";

const result = await evaluate({
  model: "typesafe-ai/jev",              // 经 Vercel AI Gateway 解析
  state: `电商售后消息：\n「${message}」\n渠道：在线客服\n店铺：示例女装店`,
  questions: {
    category:     { type: "choice",  criteria: { logistics, return_refund, product_quality, payment, other } },
    urgency:      { type: "score",   criteria: ["普通咨询", "有点着急", "明显不满", "强烈投诉"] },
    wants_refund: { type: "boolean", instructions: "顾客是否明确要求退款或退货？" },
    angry:        { type: "boolean", instructions: "顾客是否表达了强烈不满、威胁差评或投诉？" },
  },
});
```

三种问题类型对应三种答案形态：

| 类型 | 配置 | 返回 |
| --- | --- | --- |
| `choice` | 一组「选项 → 描述」映射 | `choice`（选中项） + `probabilities`（各类别概率分布，求和为 1） |
| `score` | 至少两级有序描述 | 小数 `score`（范围 0 ~ levels-1，本项目即 0–3） + 各等级概率 |
| `boolean` | 可选的真/假描述 | `probability`，即 P(true)（**不是二分类的置信度**） |

**为什么这比「生成 JSON」更强**：TypeSafe 这类原生评估模型对每个问题独立求解，
返回的是模型自身的概率分布，而不是让模型自报一个数字。因此可以直接在业务代码里写
`refundProb > 0.85 → 优先级较高` 这类阈值逻辑，并且阈值是可调、可 A/B 的。

---

## 工作流程

```
浏览器 (app/page.tsx)
   │  POST /api/triage  { message }
   ▼
Route Handler (app/api/triage/route.ts)        ← 服务端，API Key 不出网
   │  evaluate({ model: "typesafe-ai/jev", state, questions })
   ▼
Vercel AI Gateway ──▶ TypeSafe Jev 评估模型
   │  一次调用，4 个问题并行求解（含概率分布与置信度）
   ▼
answers: { category, urgency, wants_refund, angry }  (带概率)
   │
   ├─► buildDecision(answers)  lib/triage.ts（纯函数，可单测）
   │      → decision: { final, priority, category, reason, rule }
   ▼
JSON 回传 → 前端渲染「决策横幅 + 统计条 + 4 张指标卡 + 原始 JSON」
```

模型只负责**判断**，不负责**决策**。最终路由结论由 `lib/triage.ts` 的纯函数规则产出，
所以它是可审计、可修改、可单元测试的——调阈值不用改 prompt。

---

## 决策规则

`lib/triage.ts` 的 `buildDecision()`（纯函数）按短路顺序执行：

| 顺序 | 规则 | 条件 | 最终决策 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | 紧急度/情绪优先 | `urgency >= 2.5` **或** `angry > 0.7` | 建议立即转人工处理 | 高优 |
| 2 | 置信度门控 | 选中类别概率 `< 0.4`（分布存在时） | 分类置信度不足，转人工复核 | 普通 |
| 3 | 多问题交叉验证 | `refundProb > 0.8` **且** `category != return_refund` | 转退换货组复核（退款意愿与类别不一致） | 较高 |
| 4 | 退换货流程 | `category == return_refund` **且** `refundProb > 0.65` | 进入退换货/退款流程 | `> 0.85` 为「较高」，否则「普通」 |
| 5 | 类别路由（物流） | `category == logistics` | 路由到物流组查询 | 普通 |
| 6 | 类别路由（质量） | `category == product_quality` | 路由到质量问题处理 | 普通 |
| 7 | 类别路由（支付） | `category == payment` | 路由到支付/账单组处理 | 普通 |
| 8 | 默认路由 | 其他（含 `other`） | 正常路由处理 | 普通 |

每条结论都会附带一句中文 `reason`，把触发它的具体数值写清楚（如
`紧急程度 2.83/3，强烈不满概率 88%，建议优先人工介入。`），并带 `rule`
字段标识触发规则，便于测试与前端展示。

---

## 技术栈

| 项 | 版本 / 说明 |
| --- | --- |
| 框架 | Next.js **16.3.5**（App Router） |
| UI | React **19.2.8**，客户端组件 |
| 样式 | Tailwind CSS **v4**（`@tailwindcss/postcss`，`@theme inline` 配置） |
| 语言 | TypeScript 5，`strict: true`，路径别名 `@/*` |
| 模型调用 | AI SDK **v7**（`experimental_evaluate`） |
| 模型 | `typesafe-ai/jev`，经 **Vercel AI Gateway** 路由 |
| 代码风格 | ESLint 9（`eslint-config-next` flat config） |

> ⚠️ 本项目用的是 **Next.js 16**。它相对常见版本有 breaking changes，
> 编写代码前请先读 `node_modules/next/dist/docs/` 下的官方指南（见 `AGENTS.md`）。

---

## 目录结构

```
jev-ecommerce-demo/
├── app/
│   ├── api/triage/route.ts   # POST：调用 Jev 评估 + 合成决策（服务端唯一出口）
│   ├── page.tsx              # 单页 UI：输入框 / 示例 / 决策横幅 / 指标卡 / 原始 JSON
│   ├── layout.tsx            # 根布局，Geist 字体，站点元数据
│   ├── globals.css           # Tailwind v4 入口 + 主题变量
│   └── favicon.ico
├── lib/
│   └── triage.ts             # 决策纯函数 buildDecision()：阈值规则、类别/规则标签
├── public/                   # 静态资源
├── .env.local                # AI_GATEWAY_API_KEY（已被 .gitignore 忽略）
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
└── tsconfig.json
```

整个业务逻辑只有两个文件：一个路由、一个页面，没有数据库、没有状态管理、没有鉴权。

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Gateway 密钥

在项目根目录创建 `.env.local`：

```bash
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
```

密钥在 [Vercel AI Gateway](https://vercel.com/ai-gateway) 获取。
该文件已在 `.gitignore` 中被忽略，**不要提交**。

### 3. 启动

```bash
npm run dev
# http://localhost:3000
```

页面内置三个示例（清晰物流问题 / 模糊质量尺码 / 情绪激烈+要求退款），点一下即可填充输入框。

### 其他命令

```bash
npm run build   # 生产构建
npm run start   # 运行构建产物
npm run lint    # ESLint 检查
```

---

## API 接口

### `POST /api/triage`

**请求**

```json
{ "message": "这都第二次出问题了！我要求全额退款，再这样我就去投诉平台和消协！" }
```

**响应（200）**

```json
{
  "success": true,
  "answers": {
    "category": { "type": "choice", "choice": "return_refund", "probabilities": { "return_refund": 0.71, "other": 0.12 } },
    "urgency": { "type": "score", "score": 2.83, "probabilities": { "0": 0.01, "1": 0.05, "2": 0.24, "3": 0.70 } },
    "wants_refund": { "type": "boolean", "probability": 0.94 },
    "angry": { "type": "boolean", "probability": 0.88 }
  },
  "decision": {
    "final": "建议立即转人工处理",
    "priority": "高优",
    "category": "return_refund",
    "reason": "紧急程度 2.83/3，强烈不满概率 88%，建议优先人工介入。",
    "rule": "urgent"
  },
  "confidence": { "category": 0.87, "urgency": 0.92 },
  "meta": {
    "latencyMs": 612,
    "model": "typesafe-ai/jev",
    "responseId": "resp_xxx",
    "usage": { "inputTokens": 128, "outputTokens": 0 }
  }
}
```

其中 `confidence` 是 TypeSafe 特有的置信度统计（按问题 ID 分键，来自
`providerMetadata.typesafe.confidence`，区别于选项概率分布），`meta.latencyMs`
为服务端测量的评估耗时。

**错误**

| 状态码 | 场景 |
| --- | --- |
| 400 | `message` 缺失、非字符串，或超过 2000 字上限 |
| 500 | 模型调用失败，返回 `{ "error": "..." }` |

`curl` 示例：

```bash
curl -X POST http://localhost:3000/api/triage \
  -H 'Content-Type: application/json' \
  -d '{"message":"快递显示已签收但我没收到，单号SF1234567890"}'
```

---

## 设计要点

- **密钥只在服务端。** `evaluate()` 只出现在 Route Handler 里，浏览器永远拿不到 `AI_GATEWAY_API_KEY`。
- **模型判断与业务决策分离。** 决策规则抽为 `lib/triage.ts` 纯函数：改路由策略只动阈值，不动 prompt；改判别语义只动 `questions`，不动 UI。
- **置信度门控 + 交叉验证。** 类别概率过低时不盲路由（转人工复核）；退款意愿与类别判定不一致时转退换货组复核——展示多问题并行的交叉验证价值。
- **TypeSafe confidence 全程透出。** `providerMetadata.typesafe.confidence` 与延迟、token、模型 ID 一起回传并在 UI 展示。
- **竞态防护。** 前端用 `AbortController` + 请求序号：连点「开始分析」时旧请求被取消，慢响应不会覆盖新结果。
- **输入上限。** 前后端均限制 2000 字，防止异常输入直烧 Gateway 费用。
- **`zeroDataRetention: false`。** Vercel **Hobby 计划必须设为 `false`**；若你的账号支持零数据保留，可改为 `true`。
- **几乎零输出 token。** Jev 输出的是结构化评估结果而非自回归文本，UI 统计条会实时展示延迟与 token 用量以印证这一点。

### 关于阈值

`wants_refund` / `angry` 返回的 `probability` 是模型估计的 P(true)，
**AI SDK 不保证跨 provider 的校准一致性**。0.65 / 0.7 / 0.85 这些阈值是本项目为演示取的示例值，
真实场景应基于自己的标注数据调出来，而不是直接照搬。

---

## 已知问题与限制

| 问题 | 说明 |
| --- | --- |
| API 处于实验阶段 | `experimental_evaluate` 及评估模型规范可能在 patch 版本间变更 |
| 决策规则无单测 | `lib/triage.ts` 已抽为纯函数、可直接测试，但仓库尚无测试文件（可用 `ai/test` 的 `Experimental_EvaluationMockModelV4`） |
| 无持久化、无鉴权、无限流 | 纯演示项目，直接暴露到公网会产生 Gateway 费用风险 |
| 模型 ID | 使用的是 `typesafe-ai/jev`；官方文档示例中常见的是 `typesafe-ai/jev-latest`，可按 Gateway 上可用版本调整 |

---

## 参考

- AI SDK Evaluation 概念：`node_modules/ai/docs/03-ai-sdk-core/32-evaluation.mdx`
- `experimental_evaluate` API 参考：`node_modules/ai/docs/07-reference/01-ai-sdk-core/14-evaluate.mdx`
- Next.js 16 约定：见 `AGENTS.md` 与 `node_modules/next/dist/docs/`
- Vercel AI Gateway：https://vercel.com/ai-gateway
