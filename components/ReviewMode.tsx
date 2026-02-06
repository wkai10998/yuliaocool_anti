
import React, { useState, useRef, useEffect } from 'react';
import { Mic, RefreshCw, Volume2, Loader2, Sparkles, AlertCircle, Info, CheckCircle2, RotateCcw, PlayCircle, ArrowRight, Bookmark, X, ArrowLeft, Pause, Play, Square, Settings, MessageSquare, ChevronDown, Cpu, BookOpen, PenTool } from 'lucide-react';
import { Button } from './Button';
import { CorpusItem, ContextScenario } from '../types';
import { generateContextScenario, generateReviewFeedback, ReviewFeedback, generateSpeech, transcribeAudio } from '../services/zhipuService';
import { audioPlayer } from '../services/audioService';

interface ReviewModeProps {
    corpus: CorpusItem[];
    onExit: () => void;
    onAddItems: (items: CorpusItem[]) => void;
}

const COLORS = ['pink', 'blue', 'yellow', 'teal', 'green', 'orange', 'purple'];
const CACHE_KEY = 'yuliaocool_review_active_session';
const CACHE_EXPIRY_MS = 3600 * 1000; // 1 hour

const TOPIC_OPTIONS = [
    { label: '日常对话', value: 'General Daily Conversation' },
    { label: '课程展示', value: 'Class Presentation' },
    { label: '旅行', value: 'Travel' },
    { label: '商业', value: 'Business' },
    { label: '面试', value: 'Job Interview' },
];

const LOADING_STEPS = [
    { icon: <BookOpen size={16} />, text: "正在从您的语料库挑选词块..." },
    { icon: <Cpu size={16} />, text: "AI 正在分析词义关联..." },
    { icon: <PenTool size={16} />, text: "正在构思最自然的对话情景..." },
    { icon: <Sparkles size={16} />, text: "正在润色表达，注入地道语感..." },
];

const LoadingState: React.FC<{ items: string[], topic: string }> = ({ items, topic }) => {
    const [stepIdx, setStepIdx] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setStepIdx(prev => (prev + 1) % LOADING_STEPS.length);
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="h-full flex flex-col items-center justify-center bg-stone-50 p-8 animate-in fade-in duration-700">
            <div className="max-w-xl w-full flex flex-col items-center">
                <div className="relative mb-12">
                    <div className="w-24 h-24 rounded-full border-4 border-stone-100 border-t-stone-800 animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles className="text-stone-300 animate-pulse" size={32} />
                    </div>
                </div>

                <div className="space-y-6 w-full text-center">
                    <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">当前进度</span>
                        <div className="flex items-center justify-center gap-3 text-stone-600 font-medium h-6">
                            {LOADING_STEPS[stepIdx].icon}
                            <span className="animate-in slide-in-from-bottom-1 duration-300">{LOADING_STEPS[stepIdx].text}</span>
                        </div>
                    </div>

                    <div className="h-1 bg-stone-200 rounded-full w-full overflow-hidden">
                        <div className="h-full bg-stone-800 animate-[loading_8s_ease-in-out_infinite]" style={{ width: '100%' }}></div>
                    </div>

                    <div className="pt-8 text-left bg-white p-6 rounded-2xl border border-stone-100 shadow-sm animate-in slide-in-from-bottom-4 duration-1000 w-full max-h-[300px] overflow-y-auto no-scrollbar">
                        <div className="flex items-center justify-between mb-4 sticky top-0 bg-white pb-2 z-10">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">已选词块 ({items.length})</span>
                            <span className="text-[10px] font-medium text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">{topic}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {items.map((item, i) => (
                                <span key={i} className="text-xs px-2 py-2 bg-stone-50 border border-stone-100 rounded-lg text-stone-700 font-serif italic truncate">
                                    {item}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <style>{`
                @keyframes loading {
                    0% { transform: translateX(-100%); }
                    30% { transform: translateX(-40%); }
                    60% { transform: translateX(-20%); }
                    100% { transform: translateX(0%); }
                }
            `}</style>
        </div>
    );
};

export const ReviewMode: React.FC<ReviewModeProps> = ({ corpus, onExit, onAddItems }) => {
    const [step, setStep] = useState<'loading' | 'active' | 'error'>('loading');
    const [scenario, setScenario] = useState<ContextScenario | null>(null);
    const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [loadingError, setLoadingError] = useState<string | null>(null);
    const [selectedPhrases, setSelectedPhrases] = useState<string[]>([]);

    const [showSettings, setShowSettings] = useState(false);
    const [topic, setTopic] = useState("日常对话");
    const [sessionTarget, setSessionTarget] = useState(5);
    const [sessionCount, setSessionCount] = useState(0);

    const [tempTopic, setTempTopic] = useState("日常对话");
    const [tempTarget, setTempTarget] = useState(5);

    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [realtimeCaption, setRealtimeCaption] = useState("");
    const [completedPhrases, setCompletedPhrases] = useState<Set<number>>(new Set());
    const [recordingError, setRecordingError] = useState<string | null>(null);

    const [isPlayingRef, setIsPlayingRef] = useState(false);
    const [isRefLoading, setIsRefLoading] = useState(false);
    const [refAudioCache, setRefAudioCache] = useState<string | null>(null);

    // === 后台预取下一关 ===
    const [nextScenarioCache, setNextScenarioCache] = useState<{
        scenario: ContextScenario;
        phrases: string[];
        topic: string;
    } | null>(null);
    const isPrefetchingRef = useRef(false);

    // === 智能选词：优先选择待复习的词汇 ===
    const selectSmartPhrases = (count: number): string[] => {
        const now = Date.now();

        // 1. 优先选择到期需要复习的
        const dueItems = corpus
            .filter(c => c.nextReviewDate <= now)
            .sort((a, b) => a.masteryLevel - b.masteryLevel);

        // 2. 其次选择掌握度低的
        const otherItems = corpus
            .filter(c => c.nextReviewDate > now)
            .sort((a, b) => a.masteryLevel - b.masteryLevel);

        const combined = [...dueItems, ...otherItems];

        // 随机打乱但保持优先级（前 count*2 个中随机选）
        const pool = combined.slice(0, Math.max(count * 2, combined.length));
        const shuffled = pool.sort(() => 0.5 - Math.random());

        return shuffled.slice(0, count).map(c => c.english);
    };

    // === 后台预取下一关 ===
    const prefetchNextScenario = async () => {
        if (isPrefetchingRef.current || corpus.length === 0) return;
        isPrefetchingRef.current = true;

        try {
            console.log('[ReviewMode] 开始后台预取下一关...');
            const nextPhrases = selectSmartPhrases(sessionTarget > 0 ? sessionTarget : 5);
            const nextResult = await generateContextScenario(nextPhrases, topic);

            setNextScenarioCache({
                scenario: nextResult,
                phrases: nextPhrases,
                topic: topic
            });
            console.log('[ReviewMode] 下一关预取完成');
        } catch (e) {
            console.warn('[ReviewMode] 预取失败:', e);
        } finally {
            isPrefetchingRef.current = false;
        }
    };

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recognitionRef = useRef<any>(null);
    const transcriptRef = useRef<string>("");
    const pausedRef = useRef(false);

    const initSession = async () => {
        if (corpus.length === 0) {
            setLoadingError("您的语料库为空，请先添加内容。");
            setStep('error');
            return;
        }

        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const { scenario: cachedScenario, topic: cachedTopic, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_EXPIRY_MS && cachedScenario.highlights.length === sessionTarget) {
                    setTopic(cachedTopic || "日常对话");
                    setStep('loading');
                    setSelectedPhrases(cachedScenario.highlights.map((h: any) => h.original || h.text));
                    await new Promise(r => setTimeout(r, 600));
                    setScenario(cachedScenario);
                    setStep('active');
                    return;
                }
            } catch (e) {
                localStorage.removeItem(CACHE_KEY);
            }
        }
        handleStart();
    };

    useEffect(() => { initSession(); }, []);

    useEffect(() => {
        return () => {
            audioPlayer.stop();
            stopRecording();
        };
    }, [scenario]);

    const handleStart = async (overrideTopic?: string, overrideCount?: number) => {
        setStep('loading');
        setLoadingError(null);
        setFeedback(null);
        setTranscript("");
        setRealtimeCaption("");
        setCompletedPhrases(new Set()); // Ensure phrase states are reset
        setRecordingError(null);
        setRefAudioCache(null);
        transcriptRef.current = "";

        const currentCount = overrideCount !== undefined ? overrideCount : sessionTarget;
        const currentTopic = overrideTopic || topic;

        const countToPick = currentCount > 0 ? currentCount : 5;

        // 使用智能选词
        const items = selectSmartPhrases(countToPick);
        setSelectedPhrases(items);

        try {
            const result = await generateContextScenario(items, currentTopic);
            setScenario(result);
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                scenario: result,
                topic: currentTopic,
                timestamp: Date.now()
            }));
            setStep('active');

            // 完成后触发后台预取下一关
            setNextScenarioCache(null); // 清除旧缓存
            setTimeout(() => prefetchNextScenario(), 1000);
        } catch (e: any) {
            console.error("Scenario load failed:", e);
            setLoadingError(e?.message || "网络请求超时，请检查您的网络环境并重试。");
            setStep('error');
        }
    };

    const openSettings = () => {
        setTempTarget(sessionTarget);
        setTempTopic(topic);
        setShowSettings(true);
    };

    const saveSettings = () => {
        const oldTopic = topic;
        const oldTarget = sessionTarget;

        const newTopic = tempTopic;
        const newTarget = tempTarget;

        setSessionTarget(newTarget);
        setTopic(newTopic);
        setShowSettings(false);

        if (oldTopic !== newTopic || oldTarget !== newTarget) {
            localStorage.removeItem(CACHE_KEY);
            handleStart(newTopic, newTarget);
        }
    };

    const handleNextLevel = () => {
        localStorage.removeItem(CACHE_KEY);
        setSessionCount(prev => prev + 1);
        setFeedback(null);
        setTranscript("");
        setRealtimeCaption("");
        setCompletedPhrases(new Set());
        setRecordingError(null);
        setRefAudioCache(null);
        transcriptRef.current = "";

        // 如果有预取的缓存且主题匹配，直接使用（瞬间切换）
        if (nextScenarioCache && nextScenarioCache.topic === topic) {
            console.log('[ReviewMode] 使用预取缓存，瞬间切换');
            setScenario(nextScenarioCache.scenario);
            setSelectedPhrases(nextScenarioCache.phrases);
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                scenario: nextScenarioCache.scenario,
                topic: nextScenarioCache.topic,
                timestamp: Date.now()
            }));
            setStep('active');

            // 清除已用缓存并预取下一关
            setNextScenarioCache(null);
            setTimeout(() => prefetchNextScenario(), 500);
        } else {
            // 没有缓存，正常加载
            handleStart();
        }
    };

    const startRecording = async () => {
        setRecordingError(null);
        setIsRecording(true);
        setIsPaused(false);
        pausedRef.current = false;
        setTranscript("");
        setRealtimeCaption("");
        audioChunksRef.current = [];
        transcriptRef.current = "";

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4';
            const recorder = new MediaRecorder(stream, { mimeType });
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };
            recorder.start();
            mediaRecorderRef.current = recorder;

            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recog = new SpeechRecognition();
                recog.lang = 'en-US';
                recog.continuous = true;
                recog.interimResults = true;

                recog.onresult = (event: any) => {
                    let current = "";
                    let interimDisplay = "";
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        const chunk = event.results[i][0].transcript;
                        current += chunk;
                        interimDisplay += chunk;
                    }
                    if (interimDisplay.trim()) setRealtimeCaption(interimDisplay);

                    const fullTranscriptSoFar = (transcriptRef.current + " " + current).toLowerCase().replace(/[.,!?;:]/g, '');
                    if (scenario) {
                        scenario.highlights.forEach((h, idx) => {
                            const contextualText = (h.text || "").toLowerCase().replace(/[.,!?;:]/g, '');
                            const originalText = (h.original || "").toLowerCase().replace(/[.,!?;:]/g, '');

                            const isMatch = (contextualText && fullTranscriptSoFar.includes(contextualText)) ||
                                (originalText && fullTranscriptSoFar.includes(originalText));

                            if (isMatch) {
                                setCompletedPhrases(prev => {
                                    if (prev.has(idx)) return prev;
                                    return new Set(prev).add(idx);
                                });
                            }
                        });
                    }
                    if (event.results[event.results.length - 1].isFinal) {
                        transcriptRef.current += " " + current;
                        setTranscript(transcriptRef.current);
                    }
                };
                recog.onend = () => {
                    if (isRecording && !pausedRef.current && recognitionRef.current) {
                        try { recognitionRef.current.start(); } catch (e) { }
                    }
                };
                recog.start();
                recognitionRef.current = recog;
            }
        } catch (err) {
            setRecordingError("无法启动麦克风，请检查浏览器权限。");
            setIsRecording(false);
        }
    };

    const stopRecording = () => {
        if (recognitionRef.current) {
            recognitionRef.current.onend = null;
            try { recognitionRef.current.stop(); } catch (e) { }
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        }
        setIsRecording(false);
        setIsPaused(false);
        pausedRef.current = false;
    };

    const togglePause = () => {
        if (isPaused) {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') mediaRecorderRef.current.resume();
            if (recognitionRef.current) try { recognitionRef.current.start(); } catch (e) { }
            setIsPaused(false);
            pausedRef.current = false;
        } else {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.pause();
            if (recognitionRef.current) try { recognitionRef.current.stop(); } catch (e) { }
            setIsPaused(true);
            pausedRef.current = true;
        }
    };

    const restartRecording = () => {
        stopRecording();
        setCompletedPhrases(new Set()); // CRITICAL: Reset highlights when user chooses to restart recording
        setTimeout(() => startRecording(), 100);
    };

    const submitEvaluation = async () => {
        if (isRecording) stopRecording();
        setIsAnalyzing(true);
        setRecordingError(null);
        try {
            let textToEvaluate = transcriptRef.current.trim() || transcript.trim();
            if (!textToEvaluate && audioChunksRef.current.length > 0) {
                const blob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
                const base64Promise = new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(blob);
                });
                const base64Audio = await base64Promise;
                textToEvaluate = await transcribeAudio(base64Audio, mediaRecorderRef.current?.mimeType || 'audio/webm');
            }
            if (!textToEvaluate) throw new Error("未检测到有效语音输入，请重试。");
            setTranscript(textToEvaluate);
            const res = await generateReviewFeedback(textToEvaluate, scenario?.englishReference || "");
            setFeedback(res);
        } catch (e: any) {
            console.error(e);
            setRecordingError(e?.message || "评价生成失败，请稍后重试。");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleRetry = () => {
        setFeedback(null);
        setCompletedPhrases(new Set());
        setTranscript("");
        setRealtimeCaption("");
        transcriptRef.current = "";
        setRecordingError(null);
    };

    const playReferenceAudio = async () => {
        if (!scenario?.englishReference) return;
        if (isPlayingRef) { audioPlayer.stop(); setIsPlayingRef(false); return; }
        setIsRefLoading(true);
        try {
            let base64 = refAudioCache;
            if (!base64) {
                base64 = await generateSpeech(scenario.englishReference);
                setRefAudioCache(base64);
            }
            if (base64) {
                setIsRefLoading(false);
                setIsPlayingRef(true);
                await audioPlayer.play(base64, () => setIsPlayingRef(false));
            } else {
                setIsRefLoading(false);
            }
        } catch (e) {
            console.error(e);
            setIsRefLoading(false);
        }
    };

    const renderHighlightedChinese = () => {
        if (!scenario) return null;
        let text = scenario.chineseScript;
        const rawHighlights = scenario.chineseHighlights || [];
        const highlights = (rawHighlights as string[]).filter(h => h && h.trim().length > 0) || [];

        if (highlights.length === 0) return text;

        const sorted = [...new Set(highlights)].sort((a, b) => b.length - a.length);
        const escaped = sorted.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const regex = new RegExp(`(${escaped})`, 'g');

        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            parts.push(text.substring(lastIndex, match.index));
            const matchedText = match[0];
            const colorIdx = highlights.indexOf(matchedText);
            const colorClass = colorIdx >= 0 ? `highlight-${COLORS[colorIdx % COLORS.length]}` : 'highlight-stone';
            parts.push(<span key={match.index} className={colorClass}>{matchedText}</span>);
            lastIndex = regex.lastIndex;
        }

        parts.push(text.substring(lastIndex));
        return parts;
    };

    const renderEnglishReference = () => {
        if (!scenario) return null;
        let text = scenario.englishReference;
        const highlights = scenario.highlights || [];
        const sortedToMatch = [...highlights].sort((a, b) => b.text.length - a.text.length);
        const patterns = sortedToMatch.map(h => h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

        if (patterns.length === 0) return text;

        const regex = new RegExp(`(${patterns.join('|')})`, 'gi');
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            parts.push(text.substring(lastIndex, match.index));
            const matchedText = match[0];
            const idx = highlights.findIndex(h => h.text.toLowerCase() === matchedText.toLowerCase());
            const colorClass = idx >= 0 ? `highlight-${COLORS[idx % COLORS.length]}` : 'font-bold text-stone-800';
            parts.push(<span key={match.index} className={`${colorClass} font-semibold rounded px-0.5`}>{matchedText}</span>);
            lastIndex = regex.lastIndex;
        }
        parts.push(text.substring(lastIndex));
        return parts;
    };

    const isCustomTopic = !TOPIC_OPTIONS.some(opt => opt.value === tempTopic);
    const selectedTopicValue = isCustomTopic ? 'custom' : tempTopic;

    if (step === 'loading') {
        return <LoadingState items={selectedPhrases} topic={topic} />;
    }

    if (step === 'error') {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-stone-50 p-6 text-center">
                <AlertCircle className="text-red-400 mb-4" size={48} />
                <p className="text-stone-600 font-medium mb-2">哎呀，出错了</p>
                <p className="text-stone-400 text-sm mb-6 max-w-xs mx-auto">{loadingError}</p>
                <div className="flex gap-4">
                    <Button variant="outline" onClick={onExit}>返回主页</Button>
                    <Button onClick={() => handleStart()}>重试</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-stone-50 overflow-hidden relative">
            <div className="flex justify-between items-center mb-4 px-6 pt-6 relative z-20 shrink-0">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={onExit}>退出</Button>
                </div>
                <div className="relative">
                    <button onClick={openSettings} className="relative text-xs font-medium uppercase tracking-wider text-stone-500 hover:text-stone-800 flex items-center gap-2 transition-all px-3 py-2 rounded-lg hover:bg-stone-100">
                        <Settings size={20} />
                        <span className="hidden sm:inline">设置</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-6 md:p-8 pt-2">
                <div className="max-w-6xl mx-auto h-full flex flex-col gap-6">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">场景主题</p>
                        <h2 className="text-xl font-bold text-stone-900">{scenario?.topic}</h2>
                    </div>
                    <div className={`grid grid-cols-1 ${feedback ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-6 h-full pb-20`}>
                        <div className={`bg-white rounded-3xl border border-stone-100 shadow-sm flex flex-col relative overflow-hidden ${!feedback ? 'lg:col-span-2' : ''}`}>
                            <div className="relative flex flex-col h-full">
                                <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none"></div>
                                <div className="relative z-10 p-8 min-h-[320px] flex flex-col">
                                    <div className="text-2xl md:text-3xl font-medium leading-[2.2] text-stone-800 font-serif text-justify">
                                        {renderHighlightedChinese()}
                                    </div>
                                </div>
                                <div className="h-px bg-stone-100 w-full relative z-10" />
                                <div className="p-8 flex-1 flex flex-col relative z-10">
                                    {feedback ? (
                                        <div className="flex-1 flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-500 overflow-y-auto pr-2 no-scrollbar">
                                            <div className="bg-stone-50 rounded-2xl p-6 border border-stone-100 relative">
                                                <div className="flex items-center gap-2 mb-3 text-stone-400">
                                                    <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center text-[10px] font-bold text-stone-500">你</div>
                                                    <span className="text-xs font-bold uppercase tracking-widest">口述转录</span>
                                                </div>
                                                <p className="text-stone-700 font-serif italic leading-relaxed text-lg">"{feedback.punctuatedTranscript}"</p>
                                            </div>
                                            <div className="pl-4 border-l-4 border-stone-100">
                                                <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">教练洞察</h4>
                                                <p className="text-sm text-stone-600 leading-relaxed italic font-serif">"{feedback.feedback}"</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-auto">
                                            <div className="flex items-start gap-3">
                                                <Info size={16} className="text-stone-300 mt-0.5" />
                                                <p className="text-sm text-stone-400 leading-relaxed">
                                                    {recordingError ? <span className="text-red-500 font-medium">{recordingError}</span> : "点击麦克风开始口述。系统将通过双层备份技术捕获您的语音并由 AI 进行深度评测。"}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col gap-6 h-full overflow-hidden">
                            {feedback ? (
                                <div className="bg-stone-100 rounded-3xl p-8 border border-stone-200 shadow-inner h-full flex flex-col animate-in slide-in-from-right-4 duration-500 overflow-y-auto no-scrollbar">
                                    <div className="flex items-center justify-between mb-8 shrink-0">
                                        <div className="flex items-center gap-2 text-stone-500">
                                            <Sparkles size={16} />
                                            <span className="text-[10px] font-bold uppercase tracking-widest">地道表达参考</span>
                                        </div>
                                        <button onClick={playReferenceAudio} disabled={isRefLoading} className="p-3 bg-white hover:bg-stone-200 border border-stone-200 rounded-full text-stone-600 transition-all shadow-sm">
                                            {isRefLoading ? <Loader2 size={18} className="animate-spin" /> : isPlayingRef ? <X size={18} /> : <Volume2 size={18} />}
                                        </button>
                                    </div>
                                    <div className="text-xl md:text-2xl font-serif text-stone-800 leading-relaxed mb-10 text-justify shrink-0">
                                        {renderEnglishReference()}
                                    </div>
                                    <div className="bg-white rounded-2xl p-6 mt-auto border border-stone-200 shadow-sm shrink-0">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Bookmark size={14} className="text-stone-400" />
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">核心词汇映射</span>
                                        </div>
                                        <div className="space-y-4 max-h-[200px] overflow-y-auto pr-2 no-scrollbar">
                                            {scenario?.highlights.map((h, i) => (
                                                <div key={i} className="flex items-start gap-3">
                                                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 bg-${COLORS[i % COLORS.length]}-500 shrink-0`}></div>
                                                    <div>
                                                        <p className="font-serif font-bold text-stone-900 text-sm">{(h.original || h.text)}</p>
                                                        <p className="text-[10px] text-stone-500 mt-0.5">{h.translation}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-white rounded-3xl p-8 border border-stone-100 shadow-sm flex flex-col h-full overflow-hidden">
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-8 flex items-center gap-2 shrink-0">
                                        <div className="w-4 h-[2px] bg-stone-200"></div> 目标词块 ({scenario?.highlights.length})
                                    </h3>
                                    <div className="flex-1 overflow-y-auto no-scrollbar pr-2 space-y-4 pb-4">
                                        {scenario?.highlights.map((h, idx) => {
                                            const isDone = completedPhrases.has(idx);
                                            const colorClass = `card-${COLORS[idx % COLORS.length]}`;
                                            return (
                                                <div key={idx} className={`p-4 rounded-xl border border-stone-50 transition-all duration-300 ${isDone ? 'bg-stone-50 opacity-60 scale-95 shadow-none' : 'bg-white shadow-sm'} ${colorClass}`}>
                                                    <div className="flex justify-between items-start">
                                                        <h4 className={`font-bold text-sm leading-tight ${isDone ? 'line-through text-stone-400' : 'text-stone-800'}`}>
                                                            {(h.original || h.text)}
                                                        </h4>
                                                        {isDone && <CheckCircle2 size={18} className="text-emerald-500 shrink-0 ml-2" />}
                                                    </div>
                                                    <p className="text-[10px] text-stone-400 mt-1">{h.translation}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <footer className="h-28 border-t border-stone-100 flex items-center justify-between px-10 bg-white shrink-0 z-30 relative transition-all duration-500">
                {feedback ? (
                    <div className="flex items-center justify-end w-full max-w-6xl mx-auto animate-in fade-in">
                        <div className="flex gap-4">
                            <Button variant="outline" onClick={handleRetry} className="px-8 border-stone-200 text-stone-600 hover:bg-stone-50">重读一遍</Button>
                            <Button onClick={handleNextLevel} className="bg-stone-900 text-white shadow-xl px-10 flex items-center gap-2">
                                下一关卡 <ArrowRight size={16} />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-4 min-w-[200px]">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    localStorage.removeItem(CACHE_KEY);
                                    handleStart();
                                }}
                                className="text-stone-400 hover:text-stone-600 hover:bg-stone-50 px-4 flex items-center gap-2 rounded-full border border-stone-100"
                                title="换一个场景"
                            >
                                <RefreshCw size={14} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">换一题</span>
                            </Button>
                        </div>
                        <div className="flex flex-col items-center justify-center flex-1 relative gap-4">
                            {isRecording && realtimeCaption && !isPaused && (
                                <div className="absolute bottom-[calc(100%+12px)] left-0 right-0 flex justify-center pointer-events-none z-50">
                                    <div className="bg-stone-900/80 backdrop-blur-sm text-white px-5 py-3 rounded-2xl text-sm font-medium shadow-xl max-w-md text-center animate-in fade-in slide-in-from-bottom-2">
                                        {realtimeCaption}
                                    </div>
                                </div>
                            )}
                            <div className={`px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${isRecording && !isPaused ? 'bg-red-50 text-red-500 border border-red-100' : isPaused ? 'bg-amber-50 text-amber-500 border border-amber-100' : 'bg-stone-50 text-stone-400 border border-stone-100'
                                }`}>
                                {isRecording && !isPaused ? <div className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>录制中</div> : isPaused ? <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-400" />已暂停</div> : (isAnalyzing ? "分析中..." : "待机")}
                            </div>
                            <div className="flex items-center gap-6">
                                {isRecording ? (
                                    <>
                                        <button onClick={restartRecording} className="p-4 rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-800 transition-all hover:rotate-180 duration-500" title="重新录制"><RotateCcw size={20} /></button>
                                        <button onClick={togglePause} className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 active:scale-95 ${isPaused ? 'bg-amber-400 text-white hover:bg-amber-500 hover:scale-105 shadow-amber-200' : 'bg-red-500 text-white hover:bg-red-600 hover:scale-105 shadow-red-200'}`}>{isPaused ? <Play size={28} className="ml-1" /> : <Pause size={28} />}</button>
                                        <button onClick={stopRecording} className="p-4 rounded-full bg-stone-900 text-white hover:bg-stone-700 hover:scale-105 transition-all shadow-lg shadow-stone-200" title="结束录制"><Square size={20} fill="currentColor" /></button>
                                    </>
                                ) : (
                                    <button onClick={startRecording} disabled={isAnalyzing} className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 active:scale-95 bg-stone-900 hover:bg-stone-800 hover:scale-105 text-white ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : ''}`}><Mic size={28} /></button>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-4 min-w-[200px] justify-end">
                            <Button onClick={submitEvaluation} isLoading={isAnalyzing} disabled={isRecording || (!transcript && audioChunksRef.current.length === 0)} className={`bg-stone-900 text-white shadow-xl px-10 transition-opacity ${isRecording ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`}><Sparkles size={16} className="mr-2" />提交分析</Button>
                        </div>
                    </>
                )}
            </footer>

            {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/20 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm border border-stone-100">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-serif font-medium text-stone-800">设置</h3>
                            <button onClick={() => setShowSettings(false)} className="text-stone-400 hover:text-stone-600"><X size={20} /></button>
                        </div>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-stone-600 mb-2 flex items-center gap-2"><MessageSquare size={16} /> 场景主题</label>
                                <div className="relative">
                                    <select value={selectedTopicValue} onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === 'custom') setTempTopic(''); else setTempTopic(val);
                                    }} className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm appearance-none cursor-pointer">
                                        {TOPIC_OPTIONS.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                        <option value="custom">自定义输入</option>
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                                </div>
                                {selectedTopicValue === 'custom' && (<input type="text" value={tempTopic} onChange={(e) => setTempTopic(e.target.value)} placeholder="输入自定义场景主题..." className="w-full mt-3 p-3 bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm animate-in slide-in-from-top-1" autoFocus />)}
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-4"><span className="font-medium text-stone-600">单词含量</span><span className="font-bold text-stone-900 bg-stone-100 px-2 py-0.5 rounded">{tempTarget} 个</span></div>
                                <input type="range" min="3" max="12" step="1" value={tempTarget} onChange={(e) => setTempTarget(parseInt(e.target.value))} className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-stone-800" />
                            </div>
                        </div>
                        <Button onClick={saveSettings} className="w-full mt-8">确认</Button>
                    </div>
                </div>
            )}
        </div>
    );
};
