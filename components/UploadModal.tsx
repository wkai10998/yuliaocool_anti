
import React, { useState, useRef } from 'react';
import { X, Upload, FileText, Check } from 'lucide-react';
import { Button } from './Button';
import { extractCorpusFromText } from '../services/geminiService';
import { CorpusItem } from '../types';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddItems: (items: CorpusItem[]) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onAddItems }) => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const parseCSV = (text: string): CorpusItem[] => {
    // Regex to split CSV by comma only if not inside quotes
    const rows = text.split(/\r?\n/).filter(r => r.trim() !== '');
    if (rows.length < 2) return [];

    // Skip header row
    return rows.slice(1).map(row => {
        // Split by comma, ignoring commas inside quotes
        const matches = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        // Fallback simple split if regex fails for some reason or simple parsing
        const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(col => {
            let val = col.trim();
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1).replace(/""/g, '"');
            }
            return val;
        });

        // Mapping based on Export structure:
        // ID, English, Chinese, Type, Tags, MasteryLevel, NextReviewDate, AddedAt, PracticeCount, Synonyms
        return {
            id: cols[0] || crypto.randomUUID(),
            english: cols[1] || '',
            chinese: cols[2] || '',
            type: (cols[3] as any) || 'phrase',
            tags: cols[4] ? cols[4].split(';').map(t => t.trim()) : [],
            masteryLevel: parseInt(cols[5] || '0'),
            nextReviewDate: parseInt(cols[6] || Date.now().toString()),
            addedAt: parseInt(cols[7] || Date.now().toString()),
            practiceCount: parseInt(cols[8] || '0'),
            synonyms: cols[9] ? cols[9].split(';').map(s => s.trim()) : []
        };
    }).filter(i => i.english); // Filter out empty parses
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        
        // Detect JSON backup
        if (file.name.toLowerCase().endsWith('.json')) {
           try {
             const items = JSON.parse(text);
             if (Array.isArray(items) && items.length > 0 && items[0].english) {
               if (window.confirm(`发现备份文件，包含 ${items.length} 条语料。是否导入？`)) {
                   onAddItems(items as CorpusItem[]);
                   onClose();
                   return;
               }
             }
           } catch(e) {
             console.error("Invalid JSON", e);
             alert("JSON 文件无效。");
             return;
           }
        }
        // Detect CSV backup
        else if (file.name.toLowerCase().endsWith('.csv')) {
            try {
                const items = parseCSV(text);
                if (items.length > 0) {
                    if (window.confirm(`发现 CSV 备份，包含 ${items.length} 条语料。是否导入？`)) {
                        onAddItems(items);
                        onClose();
                        return;
                    }
                }
            } catch (e) {
                console.error("Invalid CSV", e);
                alert("无法解析 CSV 文件。");
                return;
            }
        }
        
        setInputText(text);
      };
      reader.readAsText(file);
    }
  };

  const handleProcess = async () => {
    if (!inputText.trim()) return;

    setIsProcessing(true);
    try {
      const result = await extractCorpusFromText(inputText);
      
      const newItems: CorpusItem[] = result.items.map(item => ({
        id: crypto.randomUUID(),
        english: item.english,
        chinese: item.chinese,
        type: item.type as any,
        tags: item.tags,
        masteryLevel: 0,
        nextReviewDate: Date.now(),
        addedAt: Date.now(),
        practiceCount: 0,
        synonyms: item.synonyms || []
      }));

      onAddItems(newItems);
      onClose();
      setInputText('');
    } catch (error) {
      console.error(error);
      alert("处理失败，请重试。");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-stone-100">
        <div className="p-4 border-b border-stone-100 flex justify-between items-center">
          <h2 className="text-lg font-serif font-medium text-stone-800">添加到语料库</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <textarea
            className="w-full h-40 p-3 rounded-lg border border-stone-200 focus:ring-2 focus:ring-stone-200 focus:border-stone-400 focus:outline-none resize-none text-stone-600 text-sm"
            placeholder="在此粘贴文本或上传文件 (txt/json/csv)..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />

          <div className="flex justify-between items-center">
             <div 
               className="flex items-center space-x-2 text-stone-500 hover:text-stone-700 cursor-pointer text-sm"
               onClick={() => fileInputRef.current?.click()}
             >
                <FileText size={16} />
                <span>导入文件 (.txt, .json, .csv)</span>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".txt,.json,.csv"
                  onChange={handleFileUpload}
                />
             </div>
             
             <div className="text-xs text-stone-400">
                {inputText.length} 字符
             </div>
          </div>
        </div>

        <div className="p-4 bg-stone-50 flex justify-end space-x-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button 
            onClick={handleProcess} 
            isLoading={isProcessing}
            disabled={!inputText.trim()}
          >
            {isProcessing ? '分析中...' : '提取并保存'}
          </Button>
        </div>
      </div>
    </div>
  );
};
