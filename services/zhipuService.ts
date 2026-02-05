/**
 * 智谱 AI Service - 替代 Gemini API
 * 
 * 模型映射：
 * - 文本生成: GLM-4.7-FlashX
 * - 语音识别: GLM-ASR-2512
 * - 语音合成: GLM-TTS
 */

import { CorpusExtractionResult, LearnContext, ContextScenario } from "../types";

// 智谱 API 配置
const ZHIPU_API_BASE = "https://open.bigmodel.cn/api/paas/v4";
const ZHIPU_API_KEY = import.meta.env.VITE_ZHIPU_API_KEY || "";

// 模型常量
const MODEL_CHAT = "GLM-4.5-Air";
const MODEL_ASR = "glm-asr-2512";
const MODEL_TTS = "glm-tts";

/**
 * 错误类型枚举
 */
enum ZhipuErrorType {
    NETWORK = "网络错误",
    AUTH = "鉴权错误",
    API = "API 返回异常",
    PARSE = "响应解析异常",
}

/**
 * 自定义错误类
 */
class ZhipuError extends Error {
    constructor(public type: ZhipuErrorType, message: string) {
        super(`[${type}] ${message}`);
        this.name = "ZhipuError";
    }
}

/**
 * 重试辅助函数，支持指数退避
 */
async function callWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        const errorMsg = error?.message || "";
        const isRetryable =
            errorMsg.includes("timeout") ||
            errorMsg.includes("500") ||
            errorMsg.includes("503") ||
            errorMsg.includes("网络错误");

        if (retries <= 0 || !isRetryable) {
            throw error;
        }

        console.warn(`智谱 API 错误，${delay}ms 后重试... (剩余 ${retries} 次). 错误: ${errorMsg}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return callWithRetry(fn, retries - 1, delay * 2);
    }
}

/**
 * 超时辅助函数
 */
const withTimeout = <T>(promise: Promise<T>, ms: number = 90000): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new ZhipuError(ZhipuErrorType.NETWORK, "请求超时")), ms)
        ),
    ]);
};

/**
 * 清理 JSON 字符串（移除 markdown 代码块标记）
 */
const cleanJsonString = (text: string): string => {
    if (!text) return "{}";
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    return cleaned;
};

/**
 * 通用 Chat Completions 调用
 */
async function chatCompletion(prompt: string, options?: {
    temperature?: number;
    responseFormat?: "json_object" | "text";
    timeout?: number;
}): Promise<string> {
    const { temperature = 0.7, responseFormat, timeout = 60000 } = options || {};

    if (!ZHIPU_API_KEY) {
        throw new ZhipuError(ZhipuErrorType.AUTH, "VITE_ZHIPU_API_KEY 环境变量未设置");
    }

    const body: Record<string, any> = {
        model: MODEL_CHAT,
        messages: [{ role: "user", content: prompt }],
        temperature,
    };

    if (responseFormat === "json_object") {
        body.response_format = { type: "json_object" };
    }

    const response = await withTimeout(
        fetch(`${ZHIPU_API_BASE}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${ZHIPU_API_KEY}`,
            },
            body: JSON.stringify(body),
        }),
        timeout
    );

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new ZhipuError(ZhipuErrorType.AUTH, `API Key 无效或权限不足 (${response.status})`);
        }
        const errorText = await response.text();
        throw new ZhipuError(ZhipuErrorType.API, `HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (!data.choices?.[0]?.message?.content) {
        throw new ZhipuError(ZhipuErrorType.PARSE, "响应格式异常：缺少 choices[0].message.content");
    }

    return data.choices[0].message.content;
}

/**
 * 语音转文本 - 使用 GLM-ASR-2512
 */
export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
    try {
        if (!ZHIPU_API_KEY) {
            throw new ZhipuError(ZhipuErrorType.AUTH, "VITE_ZHIPU_API_KEY 环境变量未设置");
        }

        // 构建 FormData
        const formData = new FormData();
        formData.append("model", MODEL_ASR);
        formData.append("file_base64", base64Audio);
        formData.append("stream", "false");

        const response = await callWithRetry(() =>
            withTimeout(
                fetch(`${ZHIPU_API_BASE}/audio/transcriptions`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${ZHIPU_API_KEY}`,
                    },
                    body: formData,
                }),
                45000
            )
        );

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new ZhipuError(ZhipuErrorType.AUTH, `API Key 无效 (${response.status})`);
            }
            const errorText = await response.text();
            throw new ZhipuError(ZhipuErrorType.API, `HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return data.text?.trim() || "";
    } catch (error: any) {
        console.error("智谱 ASR 错误:", error);
        return "";
    }
}

/**
 * 从文本提取词汇和分类
 */
export async function extractCorpusFromText(text: string): Promise<CorpusExtractionResult> {
    const prompt = `Extract English oral expressions from: "${text}". Provide Chinese translations and synonyms. Return JSON with this exact structure:
{
  "items": [
    {
      "english": "expression",
      "chinese": "中文翻译",
      "type": "phrase|word|sentence",
      "tags": ["tag1", "tag2"],
      "synonyms": ["synonym1", "synonym2"]
    }
  ]
}`;

    try {
        const response = await callWithRetry(() =>
            chatCompletion(prompt, { responseFormat: "json_object", timeout: 60000 })
        );

        const jsonStr = cleanJsonString(response);
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("提取词汇错误:", error);
        return { items: [] };
    }
}

/**
 * 生成学习上下文
 */
export async function generateLearnContext(
    item: string,
    retry: boolean = false,
    topic: string = "General Daily Conversation"
): Promise<LearnContext> {
    const prompt = `
    TASK: Generate a translation practice context for the English phrase/word: "${item}".
    USER SETTING: Current session topic is "${topic}".
    
    GUIDELINES:
    1. **Register Consistency**: Match the tone to the phrase.
    2. **Authentic Naturalness**: Native-level English.
    3. **Semantic Highlighting**: 'chineseHighlight' must be the exact substring in 'chineseContext' matching "${item}".
    
    Return JSON with this exact structure:
    {
      "chineseContext": "包含目标短语意思的中文句子",
      "chineseHighlight": "对应目标短语的中文部分",
      "englishReference": "English sentence using the phrase"
    }
  `;

    try {
        const response = await callWithRetry(() =>
            chatCompletion(prompt, { responseFormat: "json_object", timeout: 60000 })
        );

        const jsonStr = cleanJsonString(response);
        const data = JSON.parse(jsonStr);
        return {
            targetId: item,
            chineseContext: data.chineseContext || "无法生成，请重试。",
            chineseHighlight: data.chineseHighlight || "",
            englishReference: data.englishReference || "",
        };
    } catch (error) {
        console.error("生成上下文错误:", error);
        throw error;
    }
}

/**
 * 评估用户答案
 */
export async function evaluateAnswer(
    userText: string,
    referenceText: string
): Promise<{ score: number; feedback: string }> {
    const prompt = `
    Evaluation Task: Compare the "User Answer" with the "Reference English".
    
    Reference English: "${referenceText}"
    User Answer: "${userText}"
    
    Scoring Criteria:
    - 100%: Meaning is identical, and grammar is correct (ignore small punctuation/case/filler words).
    - 70-90%: Meaning is correct, but grammar or phrasing is slightly unnatural.
    - 40-69%: Meaning is partially captured, but core vocabulary or intent is wrong.
    - 0-39%: Meaning is completely different or irrelevant (e.g. user said something totally unrelated).
    
    Strict Rules:
    1. Focus on SEMANTICS. If the intent is perfect, score above 90.
    2. If the user input is irrelevant or generic nonsense (like "ok", "yes" for a long sentence), score below 10%.
    3. Provide feedback in concise Chinese (max 10 words).
    4. Return JSON: { "score": number, "feedback": string }
  `;

    try {
        const response = await callWithRetry(() =>
            chatCompletion(prompt, { responseFormat: "json_object", timeout: 30000 })
        );

        const jsonStr = cleanJsonString(response);
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("评估答案错误:", error);
        return { score: 0, feedback: "评估异常。" };
    }
}

export interface ReviewFeedback {
    score: number;
    feedback: string;
    punctuatedTranscript: string;
    improvedVersion?: string;
}

/**
 * 生成复习详细反馈
 */
export async function generateReviewFeedback(
    userText: string,
    referenceText: string
): Promise<ReviewFeedback> {
    const prompt = `Compare user input "${userText}" with reference "${referenceText}". Analyze grammar, naturalness, and vocabulary usage. Return the 'feedback' field in CHINESE.

Return JSON with this exact structure:
{
  "score": 0-100,
  "feedback": "中文反馈",
  "punctuatedTranscript": "用户输入（带正确标点）",
  "improvedVersion": "改进版本的英文"
}`;

    try {
        const response = await callWithRetry(() =>
            chatCompletion(prompt, { responseFormat: "json_object", timeout: 90000 })
        );

        const jsonStr = cleanJsonString(response);
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("生成反馈错误:", error);
        return { score: 0, feedback: "分析生成延迟。", punctuatedTranscript: userText };
    }
}

/**
 * 生成场景练习
 */
export async function generateContextScenario(
    items: string[],
    topic: string
): Promise<ContextScenario> {
    const prompt = `
    TASK: Create a natural sight translation paragraph.
    TOPIC: ${topic}
    REQUIRED ENGLISH PHRASES (MUST INCLUDE ALL ${items.length}): ${items.join(", ")}

    CRITICAL JSON FORMAT RULES:
    1. 'chineseScript': A coherent Chinese story using the meaning of all phrases.
    2. 'highlights': Array of objects. 
       - 'text': The EXACT SUBSTRING used in 'englishReference' (even if it is a conjugation like "scheduled" instead of "schedule"). This is mandatory for highlighting.
       - 'original': The dictionary form of the English phrase (e.g. "schedule").
       - 'translation': The Chinese meaning.
       - IMPORTANT: NEVER put Chinese text in 'text' or 'original' fields.
    3. 'chineseHighlights': The exact Chinese substrings in 'chineseScript' that map to the phrases.

    Return JSON with this exact structure:
    {
      "topic": "场景主题",
      "chineseScript": "中文故事",
      "chineseHighlights": ["高亮词1", "高亮词2"],
      "englishReference": "English paragraph",
      "highlights": [
        {"text": "exact phrase in English", "original": "dictionary form", "translation": "中文"}
      ]
    }
  `;

    try {
        const response = await callWithRetry(() =>
            chatCompletion(prompt, { responseFormat: "json_object", timeout: 120000 })
        );

        const jsonStr = cleanJsonString(response);
        const parsed = JSON.parse(jsonStr);

        // 恢复逻辑：修正模型可能的错误输出
        const normalizedHighlights = (parsed.highlights || []).map((h: any) => {
            const hasChinese = /[\u4e00-\u9fa5]/.test(h.original || "");
            return {
                ...h,
                text: h.text || h.original || "English Variant",
                original: hasChinese
                    ? h.text || "English Phrase"
                    : h.original || h.text || "English Phrase",
            };
        });

        return {
            topic: parsed.topic || topic,
            chineseScript: parsed.chineseScript || "",
            chineseHighlights: parsed.chineseHighlights || [],
            englishReference: parsed.englishReference || "",
            highlights: normalizedHighlights,
        };
    } catch (error) {
        console.error("生成场景错误:", error);
        throw error;
    }
}

/**
 * 文本转语音 - 使用 GLM-TTS
 * 返回 base64 编码的 PCM 音频数据（24000Hz 采样率）
 */
export async function generateSpeech(text: string): Promise<string | null> {
    if (!text) return null;

    try {
        if (!ZHIPU_API_KEY) {
            throw new ZhipuError(ZhipuErrorType.AUTH, "VITE_ZHIPU_API_KEY 环境变量未设置");
        }

        const response = await callWithRetry(() =>
            withTimeout(
                fetch(`${ZHIPU_API_BASE}/audio/speech`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${ZHIPU_API_KEY}`,
                    },
                    body: JSON.stringify({
                        model: MODEL_TTS,
                        input: text,
                        voice: "tongtong",
                        response_format: "pcm",
                    }),
                }),
                45000
            )
        );

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new ZhipuError(ZhipuErrorType.AUTH, `API Key 无效 (${response.status})`);
            }
            const errorText = await response.text();
            throw new ZhipuError(ZhipuErrorType.API, `HTTP ${response.status}: ${errorText}`);
        }

        // TTS 返回二进制音频数据，需要转换为 base64
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // 将 Uint8Array 转换为 base64
        let binary = "";
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    } catch (error) {
        console.error("TTS 错误:", error);
        return null;
    }
}
