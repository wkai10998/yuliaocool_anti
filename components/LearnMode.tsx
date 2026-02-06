
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, RotateCcw, CheckCircle, Volume2, PlayCircle, Loader2, Settings, X, Trophy, MessageSquare, PauseCircle, ChevronDown, Flag } from 'lucide-react';
import { Button } from './Button';
import { CorpusItem, LearnContext } from '../types';
import { generateLearnContext, generateSpeech } from '../services/zhipuService';
import { audioPlayer } from '../services/audioService';

interface LearnModeProps {
  corpus: CorpusItem[];
  onUpdateProgress: (itemId: string, success: boolean) => void;
  onExit: () => void;
}

const TOPIC_OPTIONS = [
  { label: '日常对话', value: 'General Daily Conversation' },
  { label: '课程展示', value: 'Class Presentation' },
  { label: '旅行', value: 'Travel' },
  { label: '商业', value: 'Business' },
  { label: '面试', value: 'Job Interview' },
];

const CACHE_EXPIRY_MS = 3600 * 1000; // 1 hour
const INITIAL_BATCH_SIZE = 3; // 首批快速生成数量（用于快速进入学习）
const TOTAL_PREFETCH_TARGET = 10; // 总预生成目标
const BACKGROUND_BATCH_SIZE = 3; // 后台每批补充数量
const PREFETCH_THRESHOLD = 3; // 剩余多少时开始补充

export const LearnMode: React.FC<LearnModeProps> = ({ corpus, onUpdateProgress, onExit }) => {
  // === 批量预生成队列系统 ===
  const [learningQueue, setLearningQueue] = useState<CorpusItem[]>([]); // 学习队列
  const [currentIndex, setCurrentIndex] = useState(0); // 当前位置
  const [contextCache, setContextCache] = useState<Map<string, LearnContext>>(new Map()); // 预生成缓存
  const [isInitializing, setIsInitializing] = useState(true); // 初始化加载状态
  const [initProgress, setInitProgress] = useState(0); // 初始化进度
  const isPrefetchingRef = useRef(false); // 防止重复预取

  // Current Item State (derived from queue)
  const currentItem = learningQueue[currentIndex] || null;
  const context = currentItem ? contextCache.get(currentItem.id) || null : null;

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [inputText, setInputText] = useState("");

  // Session Settings & Progress
  const [showSettings, setShowSettings] = useState(false);
  const [sessionTarget, setSessionTarget] = useState(10); // Default 10 items
  const [initialTarget, setInitialTarget] = useState(10); // Track the original increment
  const [sessionProgress, setSessionProgress] = useState(0);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [topic, setTopic] = useState("General Daily Conversation");

  // Temporary Settings State (for the modal)
  const [tempTarget, setTempTarget] = useState(10);
  const [tempTopic, setTempTopic] = useState("General Daily Conversation");

  // Onboarding State
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recognition, setRecognition] = useState<any>(null); // SpeechRecognition instance
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<string>(""); // Store transcript as it comes in
  const inputRef = useRef<HTMLInputElement>(null);

  // Result State
  const [userAudioUrl, setUserAudioUrl] = useState<string | null>(null);
  const [userTranscript, setUserTranscript] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Audio Playback State
  const [cachedRefAudio, setCachedRefAudio] = useState<string | null>(null);
  const [isRefAudioLoading, setIsRefAudioLoading] = useState(false);
  const [isRefAudioPlaying, setIsRefAudioPlaying] = useState(false);

  const [isUserAudioPlaying, setIsUserAudioPlaying] = useState(false);
  const userAudioRef = useRef<HTMLAudioElement | null>(null);

  // === 选择学习队列 ===
  const selectLearningQueue = useCallback((corpusList: CorpusItem[], count: number): CorpusItem[] => {
    // 优先选择到期复习的词汇，按掌握程度排序
    const dueItems = corpusList
      .filter(i => i.nextReviewDate <= Date.now())
      .sort((a, b) => a.masteryLevel - b.masteryLevel);

    // 如果到期的不够，补充其他词汇
    const otherItems = corpusList
      .filter(i => i.nextReviewDate > Date.now())
      .sort((a, b) => a.masteryLevel - b.masteryLevel);

    const combined = [...dueItems, ...otherItems];
    return combined.slice(0, Math.max(count, TOTAL_PREFETCH_TARGET * 2));
  }, []);

  // === 批量生成上下文 ===
  const generateContextsForItems = useCallback(async (
    items: CorpusItem[],
    currentTopic: string,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, LearnContext>> => {
    const results = new Map<string, LearnContext>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const cacheKey = `yuliaocool_learn_session_${item.id}`;

      // 先尝试从 localStorage 读取缓存
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { context: cachedCtx, topic: cachedTopic, timestamp } = JSON.parse(cached);
          if (cachedTopic === currentTopic && (Date.now() - timestamp < CACHE_EXPIRY_MS)) {
            results.set(item.id, cachedCtx);
            onProgress?.(i + 1, items.length);
            continue;
          }
        } catch (e) {
          localStorage.removeItem(cacheKey);
        }
      }

      // 生成新的上下文
      try {
        const ctx = await generateLearnContext(item.english, false, currentTopic);
        results.set(item.id, ctx);

        // 保存到 localStorage
        localStorage.setItem(cacheKey, JSON.stringify({
          context: ctx,
          topic: currentTopic,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.error(`生成 ${item.english} 上下文失败:`, e);
      }

      onProgress?.(i + 1, items.length);
    }

    return results;
  }, []);

  // === 初始化会话 ===
  const initSession = useCallback(async (currentTopic: string, targetCount: number) => {
    setIsInitializing(true);
    setInitProgress(0);
    setContextCache(new Map());
    setCurrentIndex(0);
    setSessionProgress(0);
    setIsSessionComplete(false);

    // 1. 选择学习队列
    const queue = selectLearningQueue(corpus, targetCount);
    setLearningQueue(queue);

    if (queue.length === 0) {
      setIsInitializing(false);
      return;
    }

    // 2. 首批快速生成（只生成 3 个，并行请求加速）
    const firstBatch = queue.slice(0, Math.min(INITIAL_BATCH_SIZE, queue.length));

    // 使用 Promise.all 并行请求，加速首批生成
    const contextPromises = firstBatch.map(async (item, index) => {
      const cacheKey = `yuliaocool_learn_session_${item.id}`;

      // 先尝试从 localStorage 读取缓存
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { context: cachedCtx, topic: cachedTopic, timestamp } = JSON.parse(cached);
          if (cachedTopic === currentTopic && (Date.now() - timestamp < CACHE_EXPIRY_MS)) {
            return { id: item.id, context: cachedCtx };
          }
        } catch (e) {
          localStorage.removeItem(cacheKey);
        }
      }

      // 生成新的上下文
      const ctx = await generateLearnContext(item.english, false, currentTopic);
      localStorage.setItem(cacheKey, JSON.stringify({
        context: ctx,
        topic: currentTopic,
        timestamp: Date.now()
      }));
      return { id: item.id, context: ctx };
    });

    // 逐个更新进度
    let completed = 0;
    const results = await Promise.all(
      contextPromises.map(p => p.then(result => {
        completed++;
        setInitProgress(Math.round((completed / firstBatch.length) * 100));
        return result;
      }))
    );

    const contexts = new Map<string, LearnContext>();
    results.forEach(r => {
      if (r.context) contexts.set(r.id, r.context);
    });

    setContextCache(contexts);
    setIsInitializing(false);

    // 3. 立即触发后台补充
    setTimeout(() => {
      isPrefetchingRef.current = false; // 确保可以开始后台预取
    }, 100);
  }, [corpus, selectLearningQueue, generateContextsForItems]);

  // === 后台补充预取 ===
  const prefetchMoreIfNeeded = useCallback(async () => {
    if (isPrefetchingRef.current) return;

    const remainingInQueue = learningQueue.length - currentIndex - 1;
    const prefetchedCount = Array.from(contextCache.keys())
      .filter(id => {
        const idx = learningQueue.findIndex(item => item.id === id);
        return idx > currentIndex;
      }).length;

    // 计算还需要预取多少才能达到目标
    const totalCached = contextCache.size;
    const needMore = totalCached < TOTAL_PREFETCH_TARGET;

    // 如果预取的数量少于阈值，或者总缓存未达目标，补充更多
    if ((prefetchedCount < PREFETCH_THRESHOLD || needMore) && remainingInQueue > prefetchedCount) {
      isPrefetchingRef.current = true;

      const startIdx = currentIndex + prefetchedCount + 1;
      const endIdx = Math.min(startIdx + BACKGROUND_BATCH_SIZE, learningQueue.length);
      const itemsToFetch = learningQueue.slice(startIdx, endIdx)
        .filter(item => !contextCache.has(item.id));

      if (itemsToFetch.length > 0) {
        console.log(`[Prefetch] 后台预取 ${itemsToFetch.length} 个词汇...`);
        const newContexts = await generateContextsForItems(itemsToFetch, topic);

        setContextCache(prev => {
          const updated = new Map(prev);
          newContexts.forEach((ctx, id) => updated.set(id, ctx));
          return updated;
        });
      }

      isPrefetchingRef.current = false;
    }
  }, [learningQueue, currentIndex, contextCache, topic, generateContextsForItems]);

  // === 生命周期 ===
  useEffect(() => {
    // Check onboarding status
    const hasSeen = localStorage.getItem('yuliaocool_settings_guide');
    if (!hasSeen) {
      setShowOnboarding(true);
    }

    // 初始化会话
    if (corpus.length > 0) {
      initSession(topic, sessionTarget);
    }

    return () => {
      if (userAudioRef.current) {
        userAudioRef.current.pause();
        userAudioRef.current = null;
      }
      audioPlayer.stop();
    };
  }, []);

  // === 后台预取触发 ===
  useEffect(() => {
    if (!isInitializing && currentItem) {
      prefetchMoreIfNeeded();
    }
  }, [currentIndex, isInitializing, prefetchMoreIfNeeded]);

  // === 音频预取（延迟执行，降低优先级）===
  useEffect(() => {
    if (context?.englishReference && !cachedRefAudio && !isInitializing) {
      const timer = setTimeout(() => {
        const prefetchAudio = async () => {
          try {
            const base64 = await generateSpeech(context.englishReference);
            if (base64) setCachedRefAudio(base64);
          } catch (e) {
            console.error("Audio prefetch failed", e);
          }
        };
        prefetchAudio();
      }, 1000); // 延迟 1 秒，确保不与上下文生成竞争

      return () => clearTimeout(timer);
    }
  }, [context, cachedRefAudio, isInitializing]);

  // --- Interactions ---

  useEffect(() => {
    return () => {

      if (userAudioUrl) URL.revokeObjectURL(userAudioUrl);
      if (userAudioRef.current) {
        userAudioRef.current.pause();
        userAudioRef.current = null;
        setIsUserAudioPlaying(false);
      }
    };
  }, [userAudioUrl]);

  const startRecording = async () => {
    try {
      // Ensure AudioPlayer context is ready
      if (audioPlayer.context && audioPlayer.context.state === 'suspended') {
        await audioPlayer.context.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      let recog: any = null;
      if (SpeechRecognition) {
        recog = new SpeechRecognition();
        recog.lang = 'en-US';
        recog.continuous = true;
        recog.interimResults = true;

        transcriptRef.current = "";

        recog.onresult = (event: any) => {
          let final = "";
          let interim = "";
          for (let i = 0; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          const currentTranscript = final + interim;
          transcriptRef.current = currentTranscript;
        };
      }

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        setUserAudioUrl(audioUrl);

        setIsProcessingAudio(true);
        await new Promise(resolve => setTimeout(resolve, 800));

        const transcript = transcriptRef.current;
        setUserTranscript(transcript);
        setInputText(transcript);

        stream.getTracks().forEach(track => track.stop());

        // 移除 AI 评估，直接显示结果对比
        setIsProcessingAudio(false);
        setShowResult(true);
      };

      recorder.start();
      if (recog) recog.start();

      setMediaRecorder(recorder);
      setRecognition(recog);
      setIsRecording(true);

      setUserTranscript(null);
      setUserAudioUrl(null);
      setShowResult(false);

    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("无法访问麦克风。");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      if (recognition) recognition.stop();
      setIsRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const submitText = async () => {
    if (!inputText.trim()) return;
    setIsProcessingAudio(true);
    setUserTranscript(inputText);

    // 移除 AI 评估，直接显示结果对比
    setIsProcessingAudio(false);
    setShowResult(true);
  };

  // --- Keyboard Listeners for Space Toggle ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // Ignore hold-down repeat events
      if (e.code === 'Space' && document.activeElement !== inputRef.current && !showResult && !isProcessingAudio && !isLoading) {
        e.preventDefault();
        toggleRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRecording, showResult, isProcessingAudio, isLoading, mediaRecorder]); // Added mediaRecorder dep

  const toggleUserAudio = () => {
    if (!userAudioUrl) return;

    if (isUserAudioPlaying) {
      userAudioRef.current?.pause();
      userAudioRef.current!.currentTime = 0;
      setIsUserAudioPlaying(false);
    } else {
      if (!userAudioRef.current || userAudioRef.current.src !== userAudioUrl) {
        userAudioRef.current = new Audio(userAudioUrl);
        userAudioRef.current.onended = () => setIsUserAudioPlaying(false);
      }
      userAudioRef.current.play();
      setIsUserAudioPlaying(true);
    }
  };

  const toggleReferenceAudio = async () => {
    if (!context?.englishReference) return;

    if (isRefAudioPlaying) {
      audioPlayer.stop(false);
      setIsRefAudioPlaying(false);
      return;
    }

    setIsRefAudioLoading(true);
    try {
      let base64 = cachedRefAudio;
      if (!base64) {
        base64 = await generateSpeech(context.englishReference);
        setCachedRefAudio(base64);
      }

      if (base64) {
        setIsRefAudioLoading(false);
        setIsRefAudioPlaying(true);
        await audioPlayer.play(base64, () => setIsRefAudioPlaying(false));
      } else {
        setIsRefAudioLoading(false);
      }
    } catch (e) {
      console.error(e);
      setIsRefAudioLoading(false);
    }
  };

  // === 重新生成当前项（用于重试场景）===
  const regenerateCurrentItem = useCallback(async () => {
    if (!currentItem) return;

    setIsLoading(true);
    try {
      const ctx = await generateLearnContext(currentItem.english, true, topic);
      setContextCache(prev => {
        const updated = new Map(prev);
        updated.set(currentItem.id, ctx);
        return updated;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [currentItem, topic]);

  const handleResult = (mastered: boolean) => {
    if (!currentItem) return;

    // Invalidate cache for the completed item so we don't load old context next time we see it
    if (mastered) {
      localStorage.removeItem(`yuliaocool_learn_session_${currentItem.id}`);
    }

    setShowResult(false);
    setUserAudioUrl(null);
    setUserTranscript(null);
    setIsRecording(false);
    setCachedRefAudio(null);
    setIsRefAudioPlaying(false);
    setIsUserAudioPlaying(false);
    setInputText("");

    if (mastered) {
      const newProgress = sessionProgress + 1;
      setSessionProgress(newProgress);
      onUpdateProgress(currentItem.id, true);

      if (sessionTarget > 0 && newProgress >= sessionTarget) {
        setIsSessionComplete(true);
        return;
      }

      // 使用队列系统：直接推进到下一个索引
      const nextIndex = currentIndex + 1;
      if (nextIndex < learningQueue.length) {
        setCurrentIndex(nextIndex);
        setRetryCount(0);
      } else {
        // 队列已完成
        onExit();
      }
    } else {
      // 重试：重新生成当前项的上下文
      setRetryCount(prev => prev + 1);
      regenerateCurrentItem();
    }
  };

  const openSettings = () => {
    setTempTarget(sessionTarget);
    setTempTopic(topic);
    setShowSettings(true);
    dismissOnboarding(false); // Close tip if open
  };

  const saveSettings = () => {
    const oldTopic = topic;
    setSessionTarget(tempTarget);
    setInitialTarget(tempTarget); // Reset the baseline increment
    setTopic(tempTopic);
    setShowSettings(false);

    // Cache Invalidation Logic
    if (oldTopic !== tempTopic) {
      // 主题变更，需要重新初始化会话
      setContextCache(new Map());
      initSession(tempTopic, tempTarget);
    }
  };


  const dismissOnboarding = (dontShowAgain: boolean) => {
    setShowOnboarding(false);
    if (dontShowAgain) {
      localStorage.setItem('yuliaocool_settings_guide', 'true');
    }
  };

  if (corpus.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <p className="text-stone-500 mb-4">语料库为空。</p>
        <Button onClick={onExit}>返回</Button>
      </div>
    );
  }

  if (isSessionComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in zoom-in duration-500">
        <div className="w-24 h-24 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-yellow-100/50">
          <Trophy size={48} />
        </div>
        <h2 className="text-3xl font-serif text-stone-800 mb-2">会话完成！</h2>
        <p className="text-stone-500 mb-8 max-w-xs mx-auto">
          你今天掌握了 {sessionProgress} 个表达。保持好习惯！
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button onClick={onExit} className="w-full py-3">返回主页</Button>
          <Button variant="ghost" onClick={() => {
            setIsSessionComplete(false);
            // Add another set based on the initial target configuration
            const newTarget = sessionTarget + initialTarget;
            setSessionTarget(newTarget);
            initSession(topic, newTarget);
          }}>再学一组</Button>
        </div>
      </div>
    );
  }

  // --- Render Chinese Context with Highlight ---
  const renderChineseContext = () => {
    if (!context) return null;
    const fullText = context.chineseContext;
    const highlight = context.chineseHighlight;

    if (!highlight || !fullText.includes(highlight)) {
      return fullText;
    }

    const parts = fullText.split(highlight);
    // Handle only the first occurrence for simplicity or map all
    return (
      <>
        {parts[0]}
        <span className="text-[#A05E5D] font-bold mx-0.5">{highlight}</span>
        {parts.slice(1).join(highlight)}
      </>
    );
  };

  // Calculate if the current temp topic is a custom one or one of the presets
  const isCustomTopic = !TOPIC_OPTIONS.some(opt => opt.value === tempTopic);
  const selectedTopicValue = isCustomTopic ? 'custom' : tempTopic;

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto p-6 relative overflow-y-auto no-scrollbar">
      <div className="flex justify-between items-center mb-4 relative z-20 shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onExit}>退出</Button>
          {sessionTarget > 0 && (
            <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2 py-1 rounded-full">
              {sessionProgress} / {sessionTarget}
            </span>
          )}
        </div>

        <div className="relative">
          <button
            onClick={openSettings}
            className={`relative text-xs font-medium uppercase tracking-wider text-stone-500 hover:text-stone-800 flex items-center gap-2 transition-all px-3 py-2 rounded-lg hover:bg-stone-100 ${showOnboarding ? 'ring-2 ring-emerald-400 ring-offset-2 bg-emerald-50' : ''}`}
          >
            <Settings size={20} />
            <span className="hidden sm:inline">设置</span>
            {showOnboarding && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </button>

          {showOnboarding && (
            <div className="absolute top-full right-0 mt-3 w-64 bg-stone-900 text-white p-4 rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2">
              <div className="absolute -top-1.5 right-6 w-3 h-3 bg-stone-900 rotate-45 transform"></div>
              <div className="relative z-10">
                <p className="text-sm mb-3">在这里选择例句风格，也可以自定义哦！</p>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-stone-400 cursor-pointer hover:text-stone-300">
                    <input type="checkbox" className="rounded border-stone-600 bg-stone-800 text-emerald-500 focus:ring-emerald-500" onChange={(e) => {
                      if (e.target.checked) dismissOnboarding(true);
                    }} />
                    不再提醒
                  </label>
                  <button onClick={() => dismissOnboarding(false)} className="text-xs font-bold text-white hover:underline">知道了</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center space-y-6 min-h-fit pb-12">
        {isInitializing ? (
          <div className="flex flex-col items-center justify-center space-y-6 py-20 animate-in fade-in duration-500">
            <div className="relative">
              <div className="w-20 h-20 rounded-full border-4 border-stone-100 border-t-stone-800 animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-stone-600">{initProgress}%</span>
              </div>
            </div>
            <div className="text-center space-y-2">
              <p className="text-stone-600 font-medium">正在快速准备学习场景...</p>
              <p className="text-stone-400 text-sm">首批 {Math.min(INITIAL_BATCH_SIZE, learningQueue.length)} 题并行生成中</p>
            </div>
            <div className="w-64 h-2 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-stone-800 transition-all duration-300 ease-out rounded-full"
                style={{ width: `${initProgress}%` }}
              ></div>
            </div>
            {learningQueue.length > 0 && (
              <div className="bg-white p-4 rounded-xl border border-stone-100 shadow-sm max-w-sm w-full">
                <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-3">本次学习词汇</p>
                <div className="flex flex-wrap gap-2">
                  {learningQueue.slice(0, INITIAL_BATCH_SIZE).map((item, i) => (
                    <span
                      key={item.id}
                      className={`text-xs px-2 py-1 rounded-full border transition-all duration-300 ${i < Math.floor((initProgress / 100) * Math.min(INITIAL_BATCH_SIZE, learningQueue.length))
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-stone-50 border-stone-100 text-stone-400'
                        }`}
                    >
                      {item.english}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center space-y-4 animate-pulse py-20">
            <div className="h-4 w-3/4 bg-stone-200 rounded"></div>
            <div className="h-32 w-full bg-stone-100 rounded-xl"></div>
            <p className="text-stone-400 text-sm">正在生成场景...</p>
          </div>
        ) : context ? (
          <>
            <div className="text-center animate-in fade-in duration-500 mb-8 mt-4 relative flex justify-center shrink-0">
              <div className="relative inline-block">
                <span className="inline-block px-4 py-1.5 rounded-full bg-stone-100 text-stone-400 text-[10px] font-bold tracking-wide mb-4 absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  用目标词汇完成中译英练习
                </span>
                {/* Brush Background */}
                <div className="absolute inset-0 bg-orange-100/80 rounded-[50%_/_50%] scale-110 blur-xl transform -rotate-1 pointer-events-none"></div>
                <h2 className="relative text-4xl md:text-5xl font-serif text-stone-900 z-10 px-6 py-2">
                  {context.targetId}
                </h2>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100 p-8 md:p-12 text-center flex flex-col items-center justify-center animate-in zoom-in-95 duration-300 relative overflow-hidden shrink-0">
              {/* Chinese Context */}
              <p className="text-2xl md:text-3xl text-stone-700 leading-relaxed font-serif mb-12">
                {renderChineseContext()}
              </p>

              {/* Input Area */}
              {!showResult && !isProcessingAudio ? (
                <div className="w-full max-w-md space-y-8 flex flex-col items-center animate-in slide-in-from-bottom-4 duration-500">
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="输入你的翻译"
                    className="w-full py-4 px-6 rounded-full border border-stone-200 focus:border-stone-400 focus:ring-0 focus:outline-none text-center text-lg font-serif text-stone-700 placeholder-stone-300 transition-all bg-white shadow-sm"
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitText()}
                  />

                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={toggleRecording}
                      className={`
                                  w-14 h-14 rounded-full border bg-white flex items-center justify-center transition-all duration-200 shadow-sm
                                  ${isRecording
                          ? 'border-red-400 text-red-500 scale-110 shadow-red-100'
                          : 'border-stone-200 text-stone-400 hover:text-stone-600 hover:border-stone-400 active:scale-95'
                        }
                                `}
                    >
                      {isRecording ? (
                        <div className="w-3 h-3 bg-red-500 rounded-sm animate-pulse" />
                      ) : (
                        <Mic size={20} />
                      )}
                    </button>
                    <span className={`text-[10px] font-bold tracking-wide uppercase transition-colors ${isRecording ? 'text-red-400' : 'text-stone-400'}`}>
                      {isRecording ? "正在录音..." : "支持语音录入"}
                    </span>
                  </div>
                </div>
              ) : isProcessingAudio ? (
                <div className="flex flex-col items-center justify-center py-10 text-stone-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-3 text-orange-300" />
                  <span className="text-xs font-bold tracking-widest uppercase">Evaluating...</span>
                </div>
              ) : (
                <div className="w-full space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                  {/* Your Answer Container - Left Aligned */}
                  <div className="w-full bg-stone-50 p-4 rounded-xl border border-stone-100 relative text-left">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Your Answer</span>
                      <button onClick={toggleUserAudio} className="text-stone-400 hover:text-stone-800 transition-colors" disabled={!userAudioUrl}>
                        {isUserAudioPlaying ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                      </button>
                    </div>
                    <p className="text-stone-700 font-medium font-serif text-left">{userTranscript || "No input detected"}</p>
                  </div>

                  {/* Reference Container - Left Aligned */}
                  <div className="w-full bg-stone-900 text-stone-50 p-6 rounded-xl shadow-lg relative overflow-hidden text-left">
                    <div className="flex items-start justify-between mb-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Reference</span>
                      <button
                        onClick={toggleReferenceAudio}
                        disabled={isRefAudioLoading}
                        className="text-stone-400 hover:text-white transition-colors disabled:opacity-50"
                      >
                        {isRefAudioLoading ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : isRefAudioPlaying ? (
                          <PauseCircle size={18} />
                        ) : (
                          <Volume2 size={18} />
                        )}
                      </button>
                    </div>
                    <p className="text-xl font-serif leading-relaxed pr-8 text-left">{context.englishReference}</p>
                  </div>
                </div>
              )}
            </div>

            {showResult && (
              <div className="flex items-center gap-4 w-full pt-4 animate-in fade-in slide-in-from-bottom-2 duration-700 max-w-2xl mx-auto shrink-0">
                <Button
                  variant="outline"
                  className="flex-1 py-4 border-stone-200 text-stone-500 hover:text-stone-800 hover:border-stone-300"
                  onClick={() => handleResult(false)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  需加强
                </Button>
                <Button
                  variant="primary"
                  className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-700 border-transparent shadow-lg shadow-emerald-200"
                  onClick={() => handleResult(true)}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  已掌握
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/20 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm border border-stone-100">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-serif font-medium text-stone-800">设置</h3>
              <button onClick={() => setShowSettings(false)} className="text-stone-400 hover:text-stone-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-2 flex items-center gap-2">
                  <MessageSquare size={16} /> 例句风格
                </label>

                <div className="relative">
                  <select
                    value={selectedTopicValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'custom') {
                        setTempTopic(''); // Clear for input
                      } else {
                        setTempTopic(val);
                      }
                    }}
                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm appearance-none cursor-pointer"
                  >
                    {TOPIC_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    <option value="custom">自定义输入</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                </div>

                {selectedTopicValue === 'custom' && (
                  <input
                    type="text"
                    value={tempTopic}
                    onChange={(e) => setTempTopic(e.target.value)}
                    placeholder="输入自定义场景主题..."
                    className="w-full mt-3 p-3 bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm animate-in slide-in-from-top-1"
                    autoFocus
                  />
                )}
              </div>

              <div>
                <div className="flex justify-between text-sm mb-4">
                  <span className="font-medium text-stone-600">目标词数</span>
                  <span className="font-bold text-stone-900 bg-stone-100 px-2 py-0.5 rounded">
                    {tempTarget === 0 ? '不限' : `${tempTarget} 个`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={tempTarget}
                  onChange={(e) => setTempTarget(parseInt(e.target.value))}
                  className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-stone-800"
                />
              </div>
            </div>

            <Button onClick={saveSettings} className="w-full mt-8">确认</Button>
          </div>
        </div>
      )}
    </div>
  );
};
