
import React, { useState, useEffect, useRef } from 'react';
import { UploadModal } from './components/UploadModal';
import { LearnMode } from './components/LearnMode';
import { ReviewMode } from './components/ReviewMode';
import { CorpusManager } from './components/CorpusManager';
import { AppMode, CorpusItem } from './types';
import { BookOpen, Mic2, Library, Zap, Clock, TrendingUp } from 'lucide-react';

const getTodayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const calculateStreak = (log: Record<string, number>) => {
  const today = new Date();
  let checkDate = new Date(today);
  let checkKey = getTodayKey();

  // If no activity today, check yesterday. If yesterday has activity, streak is alive.
  if (!log[checkKey]) {
      checkDate.setDate(checkDate.getDate() - 1);
      checkKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
      if (!log[checkKey]) return 0;
  }

  let count = 0;
  while (true) {
      const y = checkDate.getFullYear();
      const m = String(checkDate.getMonth() + 1).padStart(2, '0');
      const d = String(checkDate.getDate()).padStart(2, '0');
      const k = `${y}-${m}-${d}`;
      
      if (log[k]) {
          count++;
          checkDate.setDate(checkDate.getDate() - 1);
      } else {
          break;
      }
  }
  return count;
};

const CompactStats: React.FC<{
    todayTime: number,
    totalTime: number,
    streak: number
}> = ({ todayTime, totalTime, streak }) => {
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return { h, m };
  };

  const today = formatTime(todayTime);
  const total = formatTime(totalTime);

  return (
    <div className="w-full mt-6 bg-white rounded-[2rem] border border-stone-100 shadow-lg shadow-stone-200/40 p-8 flex flex-col md:flex-row items-center justify-between animate-in slide-in-from-bottom-6 duration-700 gap-8 md:gap-0">
       {/* Left Section (Today + Total) - 65% width visually */}
       <div className="w-full md:w-[65%] flex items-center justify-around md:justify-start md:gap-20 border-b md:border-b-0 md:border-r border-stone-100 pb-6 md:pb-0 md:pr-8">
           {/* Today */}
           <div className="flex flex-col">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                 <Clock size={12} /> 今日学习
              </span>
              <div className="flex items-baseline text-stone-900 leading-none">
                  <span className="text-4xl md:text-5xl font-bold tracking-tighter">{today.h}</span>
                  <span className="text-xs text-stone-400 font-medium ml-1 mr-2">时</span>
                  <span className="text-4xl md:text-5xl font-bold tracking-tighter">{today.m}</span>
                  <span className="text-xs text-stone-400 font-medium ml-1">分</span>
              </div>
           </div>
           
           {/* Total */}
           <div className="flex flex-col">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                 <TrendingUp size={12} /> 累计学习
              </span>
              <div className="flex items-baseline text-stone-900 leading-none">
                  <span className="text-4xl md:text-5xl font-bold tracking-tighter">{total.h}</span>
                  <span className="text-xs text-stone-400 font-medium ml-1 mr-2">时</span>
                  <span className="text-4xl md:text-5xl font-bold tracking-tighter">{total.m}</span>
                  <span className="text-xs text-stone-400 font-medium ml-1">分</span>
              </div>
           </div>
       </div>

       {/* Right Section (Streak) - 35% width visually */}
       <div className="w-full md:w-[35%] flex flex-col items-center justify-center">
           <div className="flex items-center gap-1.5 text-orange-500 mb-2">
               <Zap size={16} fill="currentColor" />
               <span className="text-[10px] font-bold uppercase tracking-widest">连续打卡</span>
           </div>
           <div className="flex items-baseline">
               <span className="text-5xl font-bold text-stone-800">{streak}</span>
               <span className="text-sm text-stone-400 ml-1 font-medium">天</span>
           </div>
       </div>
    </div>
  );
};

export default function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.DASHBOARD);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  
  // Corpus State
  const [corpus, setCorpus] = useState<CorpusItem[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('yuliaocool_corpus');
      if (saved) {
        try { return JSON.parse(saved); } catch (e) { return []; }
      }
    }
    return [];
  });

  // Activity Log State
  const [activityLog, setActivityLog] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('yuliaocool_activity');
        if (saved) {
            try { return JSON.parse(saved); } catch(e) { return {}; }
        }
    }
    return {};
  });

  // Time Tracking State
  const [todayTime, setTodayTime] = useState<number>(() => {
      const saved = localStorage.getItem('yuliaocool_today_time');
      const lastDate = localStorage.getItem('yuliaocool_last_active_date');
      const today = getTodayKey();
      if (lastDate === today && saved) return parseInt(saved);
      return 0;
  });

  const [totalTime, setTotalTime] = useState<number>(() => {
      const saved = localStorage.getItem('yuliaocool_total_time');
      return saved ? parseInt(saved) : 0;
  });

  // Timer Ref
  const timerRef = useRef<number | null>(null);

  // Persist State
  useEffect(() => {
    localStorage.setItem('yuliaocool_corpus', JSON.stringify(corpus));
  }, [corpus]);

  useEffect(() => {
    localStorage.setItem('yuliaocool_activity', JSON.stringify(activityLog));
  }, [activityLog]);

  useEffect(() => {
      localStorage.setItem('yuliaocool_today_time', todayTime.toString());
      localStorage.setItem('yuliaocool_total_time', totalTime.toString());
      localStorage.setItem('yuliaocool_last_active_date', getTodayKey());
  }, [todayTime, totalTime]);

  // Log Login Activity on Mount
  useEffect(() => {
      const today = getTodayKey();
      setActivityLog(prev => {
          if (!prev[today]) return { ...prev, [today]: 1 };
          return prev;
      });
  }, []);

  // Timer Logic: Increment when in learning modes
  useEffect(() => {
      if (mode === AppMode.LEARN || mode === AppMode.REVIEW) {
          timerRef.current = window.setInterval(() => {
              setTodayTime(t => t + 1);
              setTotalTime(t => t + 1);
          }, 1000);
      } else {
          if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
          }
      }
      return () => {
          if (timerRef.current) clearInterval(timerRef.current);
      };
  }, [mode]);

  const handleAddItems = (newItems: CorpusItem[]) => {
    setCorpus(prev => {
      const existingIds = new Set(prev.map(item => item.id));
      const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id));
      return [...prev, ...uniqueNewItems];
    });
  };

  const handleDeleteItem = (id: string) => {
    setCorpus(prev => prev.filter(item => item.id !== id));
  };

  const handleUpdateItem = (updatedItem: CorpusItem) => {
    setCorpus(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
  };

  const updateItemProgress = (id: string, success: boolean) => {
    setCorpus(prev => prev.map(item => {
      if (item.id !== id) return item;
      
      const newLevel = success ? Math.min(item.masteryLevel + 1, 5) : Math.max(item.masteryLevel - 1, 0);
      const intervals = [0, 1, 3, 7, 14, 30];
      const daysToAdd = success ? intervals[newLevel] : 0;
      const nextReview = Date.now() + (daysToAdd * 24 * 60 * 60 * 1000);

      const currentPractice = item.practiceCount || 0;
      const newPractice = currentPractice + 1;

      return {
        ...item,
        masteryLevel: newLevel,
        nextReviewDate: nextReview,
        practiceCount: newPractice
      };
    }));

    if (success) {
        const today = getTodayKey();
        setActivityLog(prev => ({
            ...prev,
            [today]: (prev[today] || 0) + 1
        }));
    }
  };

  const streak = calculateStreak(activityLog);

  const renderDashboard = () => (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-10 animate-in fade-in duration-500 pb-20 pt-20 relative">
      {/* Brand Logo - Absolute Top Left */}
      <div className="absolute top-6 left-6 flex items-center gap-2 z-10">
        <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center text-white font-serif font-bold text-lg shadow-lg shadow-stone-200/50">
          L
        </div>
        <span className="font-serif font-bold text-stone-800 text-lg tracking-tight">yuliaocool</span>
      </div>

      <header className="text-center mt-12 mb-6">
        <h1 className="text-4xl md:text-5xl font-serif text-stone-900 mb-4 tracking-tight">
          Master Your Words.
        </h1>
        <p className="text-stone-500 max-w-lg mx-auto font-light">
          拒绝死记硬背，用场景化训练，把语料变成你的主动表达。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div 
          onClick={() => setMode(AppMode.CORPUS_MANAGER)}
          className="md:col-span-2 bg-white p-6 rounded-[2rem] border border-stone-100 shadow-sm hover:shadow-md transition-all cursor-pointer group flex items-center justify-between"
        >
           <div className="flex items-center gap-4">
             <div className="w-14 h-14 bg-stone-50 text-stone-600 rounded-2xl flex items-center justify-center group-hover:bg-stone-100 transition-colors">
               <Library size={24} />
             </div>
             <div>
                <h3 className="font-bold text-stone-800 text-lg">我的语料库</h3>
                <p className="text-sm text-stone-400 mt-0.5">{corpus.length} 条核心语料</p>
             </div>
           </div>
           
           <div className="w-10 h-10 rounded-full border border-stone-100 flex items-center justify-center text-stone-400 group-hover:bg-stone-900 group-hover:text-white group-hover:border-transparent transition-all">
             <span className="text-lg">→</span>
           </div>
        </div>

        <div 
          onClick={() => setMode(AppMode.LEARN)}
          className="group relative bg-white p-8 rounded-[2.5rem] border border-stone-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer overflow-hidden flex flex-col justify-between h-80"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500">
            <BookOpen size={140} />
          </div>
          <div>
            <div className="w-14 h-14 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center mb-6 shadow-sm">
              <BookOpen size={24} />
            </div>
            <h2 className="text-2xl font-serif font-bold text-stone-900 mb-3">词块学习</h2>
            <p className="text-stone-500 text-sm leading-relaxed mb-6">
              单句场景式训练。告别 “背了不会用”，在真实语境中掌握核心搭配。
            </p>
          </div>
          <span className="text-sm font-bold text-stone-800 flex items-center gap-2 group-hover:gap-3 transition-all">
            开始训练 <span className="text-lg">→</span>
          </span>
        </div>

        <div 
           onClick={() => setMode(AppMode.REVIEW)}
           className="group relative bg-stone-900 p-8 rounded-[2.5rem] border border-stone-800 shadow-xl shadow-stone-200 hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer overflow-hidden flex flex-col justify-between h-80"
        >
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500">
            <Mic2 size={140} className="text-white" />
          </div>
          <div>
            <div className="w-14 h-14 bg-stone-800 text-stone-200 rounded-2xl flex items-center justify-center mb-6 border border-stone-700/50 shadow-inner">
              <Mic2 size={24} />
            </div>
            <h2 className="text-2xl font-serif font-bold text-white mb-3">语境实战</h2>
            <p className="text-stone-400 text-sm leading-relaxed mb-6">
              段落视译挑战。模拟真实对话逻辑，强迫输出，锻炼连贯口语表达能力。
            </p>
          </div>
          <span className="text-sm font-bold text-white flex items-center gap-2 group-hover:gap-3 transition-all">
            开始实战 <span className="text-lg">→</span>
          </span>
        </div>
      </div>
      
      <CompactStats todayTime={todayTime} totalTime={totalTime} streak={streak} />
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-stone-50 overflow-hidden">
      {/* Navbar Removed */}

      <main className="flex-1 overflow-hidden relative h-full">
        {mode === AppMode.DASHBOARD && (
          <div className="h-full overflow-y-auto no-scrollbar">
            {renderDashboard()}
          </div>
        )}

        {mode === AppMode.LEARN && (
          <LearnMode 
            corpus={corpus}
            onUpdateProgress={updateItemProgress}
            onExit={() => setMode(AppMode.DASHBOARD)}
          />
        )}

        {mode === AppMode.REVIEW && (
          <ReviewMode
            corpus={corpus}
            onAddItems={handleAddItems}
            onExit={() => setMode(AppMode.DASHBOARD)}
          />
        )}

        {mode === AppMode.CORPUS_MANAGER && (
          <CorpusManager
            items={corpus}
            onBack={() => setMode(AppMode.DASHBOARD)}
            onAdd={() => setIsUploadOpen(true)}
            onBulkAdd={handleAddItems}
            onDelete={handleDeleteItem}
            onUpdate={handleUpdateItem}
          />
        )}
      </main>

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onAddItems={handleAddItems}
      />
    </div>
  );
}
