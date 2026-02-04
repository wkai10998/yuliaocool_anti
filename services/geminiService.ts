
import { GoogleGenAI, Type, Modality, GenerateContentResponse } from "@google/genai";
import { CorpusExtractionResult, LearnContext, ContextScenario } from "../types";

// Initializing the Gemini API client directly with the environment variable.
export const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Robust helper to retry a promise-returning function with exponential backoff.
 */
async function callWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error?.message || "";
    const isRetryable = 
      errorMsg.includes('timeout') || 
      errorMsg.includes('500') || 
      errorMsg.includes('Rpc failed') || 
      errorMsg.includes('xhr error') ||
      errorMsg.includes('UNKNOWN');

    if (retries <= 0 || !isRetryable) {
      throw error;
    }
    
    console.warn(`Gemini API error detected. Retrying in ${delay}ms... (${retries} attempts left). Error: ${errorMsg}`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return callWithRetry(fn, retries - 1, delay * 2);
  }
}

// Helper for timeouts to prevent hanging requests
const withTimeout = <T>(promise: Promise<T>, ms: number = 90000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Request timeout")), ms))
  ]);
};

// Helper to sanitize JSON string
const cleanJsonString = (text: string): string => {
  if (!text) return "{}";
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned;
}

/**
 * Transcribes audio using Gemini's multimodal capabilities.
 */
export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
  const model = "gemini-3-flash-preview";
  try {
    const response = await callWithRetry(() => withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { inlineData: { data: base64Audio, mimeType } },
            { text: "Please transcribe the English speech exactly. No explanations." }
          ]
        }
      ]
    }), 45000));
    return response.text?.trim() || "";
  } catch (error) {
    console.error("Gemini Transcription Error:", error);
    return "";
  }
}

/**
 * Extracts vocabulary and categorization from raw text.
 */
export async function extractCorpusFromText(text: string): Promise<CorpusExtractionResult> {
  const model = "gemini-3-flash-preview";
  const prompt = `Extract English oral expressions from: "${text}". Provide Chinese translations and synonyms. Return JSON.`;

  try {
    const response = await callWithRetry(() => withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  english: { type: Type.STRING },
                  chinese: { type: Type.STRING },
                  type: { type: Type.STRING },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
              },
            },
          },
        },
      },
    }), 60000));

    const jsonStr = cleanJsonString(response.text || '{"items": []}');
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error extracting corpus:", error);
    return { items: [] };
  }
}

/**
 * IMPROVED: Generates high-quality context for a corpus item.
 */
export async function generateLearnContext(
  item: string, 
  retry: boolean = false, 
  topic: string = "General Daily Conversation"
): Promise<LearnContext> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    TASK: Generate a translation practice context for the English phrase/word: "${item}".
    USER SETTING: Current session topic is "${topic}".
    
    GUIDELINES:
    1. **Register Consistency**: Match the tone to the phrase.
    2. **Authentic Naturalness**: Native-level English.
    3. **Semantic Highlighting**: 'chineseHighlight' must be the exact substring in 'chineseContext' matching "${item}".
    
    Output JSON.
  `;

  try {
    const response = await callWithRetry(() => withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            chineseContext: { type: Type.STRING },
            chineseHighlight: { type: Type.STRING },
            englishReference: { type: Type.STRING },
          },
        },
      },
    }), 60000));

    const jsonStr = cleanJsonString(response.text || '{}');
    const data = JSON.parse(jsonStr);
    return {
      targetId: item,
      chineseContext: data.chineseContext || "无法生成，请重试。",
      chineseHighlight: data.chineseHighlight || "",
      englishReference: data.englishReference || ""
    };
  } catch (error) {
    console.error("Error generating context:", error);
    throw error;
  }
}

/**
 * Evaluates the user's spoken answer against the reference.
 * Optimized for gemini-flash-lite-latest with robust instruction.
 */
export async function evaluateAnswer(userText: string, referenceText: string): Promise<{ score: number, feedback: string }> {
  // Reverted to gemini-flash-lite-latest for performance
  const model = "gemini-flash-lite-latest"; 
  
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
    const response = await callWithRetry(() => withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            feedback: { type: Type.STRING },
          },
        },
      },
    }), 30000));

    const jsonStr = cleanJsonString(response.text || '{"score": 0, "feedback": "评分失败"}');
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error evaluating answer:", error);
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
 * Generates detailed feedback for review.
 */
export async function generateReviewFeedback(userText: string, referenceText: string): Promise<ReviewFeedback> {
  const model = "gemini-3-flash-preview";
  const prompt = `Compare user input "${userText}" with reference "${referenceText}". Analyze grammar, naturalness, and vocabulary usage. Return the 'feedback' field in CHINESE. Return JSON.`;

  try {
    const response = await callWithRetry(() => withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            feedback: { type: Type.STRING },
            punctuatedTranscript: { type: Type.STRING },
            improvedVersion: { type: Type.STRING },
          },
        },
      },
    }), 90000));

    const jsonStr = cleanJsonString(response.text || '{}');
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error generating feedback:", error);
    return { score: 0, feedback: "分析生成延迟。", punctuatedTranscript: userText };
  }
}

/**
 * Generates an interpreter training scenario.
 */
export async function generateContextScenario(
  items: string[], 
  topic: string
): Promise<ContextScenario> {
  const model = "gemini-3-flash-preview";
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

    Return JSON only.
  `;

  try {
    const response = await callWithRetry(() => withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING },
            chineseScript: { type: Type.STRING },
            chineseHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            englishReference: { type: Type.STRING },
            highlights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  original: { type: Type.STRING },
                  translation: { type: Type.STRING }
                }
              }
            }
          },
        },
      },
    }), 120000));

    const jsonStr = cleanJsonString(response.text || '{}');
    const parsed = JSON.parse(jsonStr);
    
    // Recovery logic if model hallucinates field content or misses exact variant
    const normalizedHighlights = (parsed.highlights || []).map((h: any) => {
        const hasChinese = /[\u4e00-\u9fa5]/.test(h.original || "");
        return {
            ...h,
            text: h.text || h.original || "English Variant",
            original: hasChinese ? (h.text || "English Phrase") : (h.original || h.text || "English Phrase")
        };
    });

    return {
      topic: parsed.topic || topic,
      chineseScript: parsed.chineseScript || "",
      chineseHighlights: parsed.chineseHighlights || [],
      englishReference: parsed.englishReference || "",
      highlights: normalizedHighlights
    };
  } catch (error) {
    console.error("Error generating scenario:", error);
    throw error;
  }
}

/**
 * Generates speech audio.
 */
export async function generateSpeech(text: string): Promise<string | null> {
  if (!text) return null;
  const model = "gemini-2.5-flash-preview-tts";
  try {
    const response = await callWithRetry(() => withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
        },
      },
    }), 45000));
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}
