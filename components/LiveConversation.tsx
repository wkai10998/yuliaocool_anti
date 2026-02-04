import React from 'react';
import { ArrowLeft, Activity, AlertCircle } from 'lucide-react';

/**
 * LiveConversation 组件 - 实时对话
 * 
 * 注意：智谱 AI 目前没有与 Gemini Live 对应的实时对话 API。
 * 此功能暂时不可用，显示提示信息。
 * 
 * 如果智谱未来推出实时对话 API，可以在此实现。
 */

interface LiveConversationProps {
  onExit: () => void;
}

export const LiveConversation: React.FC<LiveConversationProps> = ({ onExit }) => {
  return (
    <div className="flex flex-col h-full bg-stone-900 text-stone-50 relative overflow-hidden">
      {/* 背景装饰 */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-700/20 blur-3xl"
        style={{ width: '200px', height: '200px' }}
      ></div>

      {/* 顶部导航 */}
      <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-center z-10">
        <button onClick={onExit} className="p-2 bg-stone-800 rounded-full hover:bg-stone-700 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2 px-3 py-1 bg-stone-800 rounded-full text-xs font-medium tracking-wider text-stone-400">
          <div className="w-2 h-2 rounded-full bg-stone-600"></div>
          功能暂不可用
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col items-center justify-center z-10 space-y-8">
        <div className="relative">
          <div
            className="w-40 h-40 rounded-full bg-gradient-to-br from-stone-800 to-stone-900 border border-stone-700 flex items-center justify-center shadow-2xl"
          >
            <Activity size={48} className="text-stone-500" />
          </div>

          <div className="absolute inset-0 border border-stone-700/50 rounded-full w-40 h-40 animate-[spin_10s_linear_infinite]"></div>
        </div>

        <div className="text-center space-y-4 max-w-md mx-auto px-6">
          <h2 className="text-2xl font-serif font-medium">自由对话</h2>

          <div className="flex items-start gap-3 p-4 bg-stone-800/50 rounded-lg border border-stone-700">
            <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-left space-y-2">
              <p className="text-stone-300 text-sm">
                此功能需要实时语音对话 API 支持。
              </p>
              <p className="text-stone-400 text-xs">
                智谱 AI 目前暂未提供与 Gemini Live 对应的实时对话接口。
                其他功能（学习模式、复习模式）可正常使用。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="p-8 pb-12 flex justify-center items-center z-10">
        <button
          onClick={onExit}
          className="px-6 py-3 rounded-full bg-stone-800 hover:bg-stone-700 text-white transition-colors"
        >
          返回
        </button>
      </div>
    </div>
  );
};