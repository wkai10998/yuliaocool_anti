import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mic, MicOff, X, Activity } from 'lucide-react';
import { ai } from '../services/geminiService';
import { LiveServerMessage, Modality } from '@google/genai';
import { decodeAudioData, float32ToPcmBase64 } from '../services/audioService';

interface LiveConversationProps {
  onExit: () => void;
}

export const LiveConversation: React.FC<LiveConversationProps> = ({ onExit }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);

  // Audio Contexts
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  
  // Nodes
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  
  // State for session logic
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Animation frame for volume visualizer
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  const connect = async () => {
    try {
      setError(null);
      // Setup Audio Contexts
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      outputNodeRef.current = outputContextRef.current.createGain();
      outputNodeRef.current.connect(outputContextRef.current.destination);

      // CRITICAL: Resume context for Chrome/Autoplay policy
      if (inputContextRef.current.state === 'suspended') await inputContextRef.current.resume();
      if (outputContextRef.current.state === 'suspended') await outputContextRef.current.resume();

      // Setup Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Connect to Gemini Live - Using correct model name from instructions
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: "You are a helpful, friendly English tutor. Keep responses concise and conversational. Help the user practice speaking.",
        },
        callbacks: {
          onopen: () => {
            console.log("Live Session Opened");
            setIsConnected(true);
            
            if (!inputContextRef.current) return;
            
            inputSourceRef.current = inputContextRef.current.createMediaStreamSource(stream);
            processorRef.current = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            
            // Setup Visualizer
            analyserRef.current = inputContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            inputSourceRef.current.connect(analyserRef.current);
            
            processorRef.current.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBase64 = float32ToPcmBase64(inputData);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: {
                    mimeType: 'audio/pcm;rate=16000',
                    data: pcmBase64
                  }
                });
              });
            };

            inputSourceRef.current.connect(processorRef.current);
            processorRef.current.connect(inputContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
             const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (base64Audio && outputContextRef.current && outputNodeRef.current) {
                 const ctx = outputContextRef.current;
                 const buffer = await decodeAudioData(base64Audio, ctx, 24000);
                 
                 nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                 
                 const source = ctx.createBufferSource();
                 source.buffer = buffer;
                 source.connect(outputNodeRef.current);
                 source.start(nextStartTimeRef.current);
                 
                 nextStartTimeRef.current += buffer.duration;
                 sourcesRef.current.add(source);
                 
                 source.onended = () => {
                   sourcesRef.current.delete(source);
                 };
             }
             
             if (msg.serverContent?.interrupted) {
                sourcesRef.current.forEach(s => {
                    try { s.stop(); } catch(e) {}
                });
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
             }
          },
          onclose: () => {
            console.log("Live Session Closed");
            setIsConnected(false);
          },
          onerror: (e) => {
            console.error("Live Session Error:", e);
            setError("连接异常，请刷新重试。");
            cleanup();
          }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (e) {
      console.error(e);
      setError("无法访问麦克风或连接失败，请检查浏览器权限设置。");
    }
  };

  const cleanup = () => {
    sessionRef.current?.then((s: any) => s.close());
    inputSourceRef.current?.disconnect();
    processorRef.current?.disconnect();
    inputContextRef.current?.close();
    outputContextRef.current?.close();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  };

  useEffect(() => {
    connect();
    
    const visualize = () => {
       if (analyserRef.current) {
         const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
         analyserRef.current.getByteFrequencyData(dataArray);
         const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
         setVolume(average);
       }
       animationRef.current = requestAnimationFrame(visualize);
    };
    visualize();

    return cleanup;
  }, []);

  return (
    <div className="flex flex-col h-full bg-stone-900 text-stone-50 relative overflow-hidden">
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/20 blur-3xl transition-all duration-75"
        style={{ width: `${200 + volume * 2}px`, height: `${200 + volume * 2}px` }}
      ></div>

      <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-center z-10">
        <button onClick={onExit} className="p-2 bg-stone-800 rounded-full hover:bg-stone-700 transition-colors">
           <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2 px-3 py-1 bg-stone-800 rounded-full text-xs font-medium tracking-wider text-emerald-400">
           <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-stone-600'}`}></div>
           {isConnected ? '连线中' : '连接中...'}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center z-10 space-y-12">
        <div className="relative">
             <div 
               className="w-40 h-40 rounded-full bg-gradient-to-br from-stone-800 to-stone-900 border border-stone-700 flex items-center justify-center shadow-2xl transition-transform duration-100"
               style={{ transform: `scale(${1 + (volume / 255) * 0.2})` }}
             >
                <Activity size={48} className="text-stone-500" />
             </div>
             
             <div className="absolute inset-0 border border-stone-700/50 rounded-full w-40 h-40 animate-[spin_10s_linear_infinite]"></div>
             <div className="absolute -inset-4 border border-stone-800/50 rounded-full w-48 h-48 animate-[spin_15s_linear_infinite_reverse]"></div>
        </div>

        <div className="text-center space-y-2 max-w-xs mx-auto">
           <h2 className="text-2xl font-serif font-medium">自由对话</h2>
           <p className="text-stone-400 text-sm px-4">
             {error ? <span className="text-red-400">{error}</span> : "自然交谈，我在听。如果长时间无响应，请点击结束重连。"}
           </p>
        </div>
      </div>

      <div className="p-8 pb-12 flex justify-center items-center gap-6 z-10">
         <button 
           onClick={() => setIsMuted(!isMuted)}
           className={`p-6 rounded-full transition-all duration-300 ${isMuted ? 'bg-red-500/20 text-red-500' : 'bg-stone-800 hover:bg-stone-700 text-white'}`}
         >
           {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
         </button>
         
         <button 
           onClick={onExit}
           className="p-6 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-900/20 transition-colors"
         >
           <X size={28} />
         </button>
      </div>
    </div>
  );
};