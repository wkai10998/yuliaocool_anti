
import React, { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Search, Trash2, Edit2, Plus, Tag, MoreVertical, Download, Sparkles, Gift } from 'lucide-react';
import { Button } from './Button';
import { CorpusItem } from '../types';

interface CorpusManagerProps {
  items: CorpusItem[];
  onBack: () => void;
  onAdd: () => void;
  onBulkAdd?: (items: CorpusItem[]) => void;
  onDelete: (id: string) => void;
  onUpdate: (item: CorpusItem) => void;
}

const OFFICIAL_RECOMMENDED_PACK: Array<{ english: string; chinese: string; synonyms: string[] }> = [
  { english: 'in the hands of', chinese: '由...负责', synonyms: ['controlled by', 'responsible by', 'in the charge of'] },
  { english: 'scheduled', chinese: '已安排', synonyms: ['planned', 'arranged', 'set for'] },
  { english: 'How are you feeling?', chinese: '你感觉怎么样？', synonyms: ['How do you feel?', 'Are you okay?', 'What\'s up?'] },
  { english: 'think on one\'s feet', chinese: '反应灵敏', synonyms: ['react quickly', 'improvise', 'be sharp'] },
  { english: 'look through', chinese: '浏览', synonyms: ['scan', 'browse', 'examine'] },
  { english: 'by mistake', chinese: '错误地', synonyms: ['accidentally', 'unintentionally', 'inadvertently'] },
  { english: 'people person', chinese: '社交达人', synonyms: ['extrovert', 'sociable person', 'outgoing person'] },
  { english: 'be allowed to', chinese: '被允许', synonyms: ['be permitted to', 'can', 'have permission to'] },
  { english: 'have an edge over', chinese: '优于', synonyms: ['have an advantage over', 'outperform', 'be superior to'] },
  { english: 'add value to', chinese: '增加价值', synonyms: ['enhance', 'improve', 'contribute to'] },
  { english: 'gain some hands-on skills in', chinese: '获得...的实践经验', synonyms: ['acquire practical skills in', 'get real-world experience in'] },
  { english: 'offer a different perspective', chinese: '提供不同的视角', synonyms: ['provide a new angle', 'give a fresh view'] },
  { english: 'equip oneself with', chinese: '武装自己', synonyms: ['prepare oneself with', 'arm oneself with', 'learn'] },
  { english: 'would like to do something', chinese: '想要做某事', synonyms: ['want to do', 'wish to do', 'desire to do'] },
  { english: 'be available to', chinese: '有空', synonyms: ['be free to', 'have time to', 'be ready to'] },
  { english: 'make one’s mind up', chinese: '下定决心', synonyms: ['decide', 'make a decision', 'determine'] },
  { english: 'be associated with', chinese: '与...相关', synonyms: ['be related to', 'be connected with', 'be linked to'] },
  { english: 'work out', chinese: '锻炼/解决', synonyms: ['exercise', 'solve', 'figure out'] },
  { english: 'change one\'s mind', chinese: '改变主意', synonyms: ['reconsider', 'think twice', 'alter one\'s decision'] },
  { english: 'reach out to', chinese: '联系', synonyms: ['contact', 'get in touch with', 'communicate with'] },
];

export const CorpusManager: React.FC<CorpusManagerProps> = ({
  items,
  onBack,
  onAdd,
  onBulkAdd,
  onDelete,
  onUpdate
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingItem, setEditingItem] = useState<CorpusItem | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Check for onboarding status on mount
  useEffect(() => {
    const hasSeen = localStorage.getItem('yuliaocool_corpus_guide_seen');
    if (!hasSeen) {
      setShowGuide(true);
    }
  }, []);

  const dismissGuide = (dontShowAgain: boolean) => {
    setShowGuide(false);
    if (dontShowAgain) {
      localStorage.setItem('yuliaocool_corpus_guide_seen', 'true');
    }
  };

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter(item =>
      item.english.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.chinese && item.chinese.includes(searchTerm)) ||
      item.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [items, searchTerm]);

  // Handle Bulk Add Recommended
  const handleAddOfficialPack = () => {
      if (!onBulkAdd) return;
      const newItems: CorpusItem[] = OFFICIAL_RECOMMENDED_PACK.map(data => ({
          id: crypto.randomUUID(),
          english: data.english,
          chinese: data.chinese,
          type: 'phrase',
          tags: [], // Removed '官方推荐' tag as requested
          masteryLevel: 0,
          nextReviewDate: Date.now(),
          addedAt: Date.now(),
          practiceCount: 0,
          synonyms: data.synonyms
      }));
      onBulkAdd(newItems);
  };

  // Handle Edit Save
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      onUpdate(editingItem);
      setEditingItem(null);
    }
  };

  // Export Backup as CSV (Excel Compatible)
  const handleExport = () => {
    const headers = ['English', 'Chinese', 'Synonyms'];
    const csvRows = items.map(item => {
      const escape = (text: string | number | undefined) => {
        const str = String(text || '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      return [
        escape(item.english),
        escape(item.chinese),
        escape((item.synonyms || []).join(';'))
      ].join(',');
    });

    const csvString = [headers.join(','), ...csvRows].join('\n');
    const BOM = "\uFEFF"; 
    const blob = new Blob([BOM + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `yuliaocool_corpus_backup_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-full bg-stone-50 animate-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="h-16 bg-white border-b border-stone-100 flex items-center justify-between px-6 sticky top-0 z-20 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-stone-100 rounded-full text-stone-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-lg font-serif font-medium text-stone-800">我的语料库</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleExport} className="text-stone-500 hidden md:flex" title="导出 Excel/CSV">
            <Download size={16} className="mr-2" /> 导出备份
          </Button>
          
          <div className="relative">
             <Button 
                size="sm" 
                onClick={() => {
                    onAdd();
                    if (showGuide) dismissGuide(true);
                }} 
                className={`flex items-center gap-2 relative ${showGuide ? 'ring-2 ring-emerald-400 ring-offset-2 z-50' : ''}`}
             >
                <Plus size={16} /> 添加
                {showGuide && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                )}
             </Button>
             
             {showGuide && (
                <div className="absolute top-full right-0 mt-3 w-64 bg-stone-900 text-white p-4 rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="absolute -top-1.5 right-6 w-3 h-3 bg-stone-900 rotate-45 transform"></div>
                    <div className="relative z-10">
                        <p className="text-sm mb-3 font-medium">点击这里添加你的个人语料</p>
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-xs text-stone-400 cursor-pointer hover:text-stone-300">
                                <input 
                                    type="checkbox" 
                                    className="rounded border-stone-600 bg-stone-800 text-emerald-500 focus:ring-emerald-500" 
                                    onChange={(e) => {
                                        if (e.target.checked) dismissGuide(true);
                                    }} 
                                />
                                不再提醒
                            </label>
                            <button onClick={() => dismissGuide(false)} className="text-xs font-bold text-white hover:underline">知道了</button>
                        </div>
                    </div>
                </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col max-w-4xl mx-auto w-full p-6">
        {/* Search */}
        <div className="relative mb-6 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
          <input
            type="text"
            placeholder="搜索短语、释义或标签..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-200 transition-all text-sm shadow-sm"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 pb-20">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-8 py-12 animate-in fade-in duration-700">
              <div className="text-center text-stone-400">
                <Search size={48} className="mx-auto mb-4 opacity-20" />
                <p>{searchTerm ? "未找到匹配项。" : "语料库中暂无内容。"}</p>
              </div>

              {!searchTerm && (
                <div className="w-full max-w-md bg-white border border-stone-100 rounded-3xl p-8 shadow-sm flex flex-col items-center text-center relative overflow-hidden group">
                  <div className="w-16 h-16 bg-stone-50 text-stone-400 rounded-2xl flex items-center justify-center mb-6 border border-stone-100 shadow-inner relative z-10">
                    <Gift size={32} strokeWidth={1.5} />
                  </div>
                  
                  <h4 className="text-lg font-serif font-bold text-stone-800 mb-2 relative z-10">新手福利</h4>
                  <p className="text-stone-400 text-sm leading-relaxed mb-8 px-4 relative z-10 max-w-[280px]">
                    官方推荐语料包（含 20 个实用内容），一键添加到你的语料库～
                  </p>
                  
                  <Button 
                    onClick={handleAddOfficialPack} 
                    className="w-full bg-stone-900 hover:bg-stone-800 text-white py-4 font-bold relative z-10 rounded-2xl"
                  >
                    一键添加
                  </Button>
                </div>
              )}
            </div>
          ) : (
            filteredItems.map(item => (
              <div key={item.id} className="group bg-white p-5 rounded-xl border border-stone-100 shadow-sm hover:shadow-md transition-all flex justify-between items-start">
                <div className="flex-1 pr-4">
                  <div className="mb-1">
                    <h3 className="font-medium text-stone-900 text-xl font-serif leading-tight mb-1">{item.english}</h3>
                    <p className="text-stone-500 font-serif text-sm italic">{item.chinese}</p>
                  </div>
                  
                  {/* Synonyms (Previously Official Recommended Tag location) */}
                  {item.synonyms && item.synonyms.length > 0 && (
                    <div className="mt-1 text-xs text-stone-500 inline-block rounded-lg">
                      <span className="font-bold mr-1 text-stone-400 tracking-wide text-[10px]">近义：</span>
                      <span className="text-stone-600 italic font-serif">{item.synonyms.join(', ')}</span>
                    </div>
                  )}

                  {/* Regular Tags */}
                  {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {item.tags.map(tag => (
                          <span key={tag} className="flex items-center text-[10px] uppercase tracking-wider text-stone-400 bg-stone-50 border border-stone-100 px-2 py-1 rounded-full">
                            <Tag size={10} className="mr-1" /> {tag}
                          </span>
                        ))}
                      </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingItem(item);
                    }}
                    className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={(e) => {
                       e.stopPropagation();
                       if (window.confirm("确定要删除这条语料吗？")) {
                         onDelete(item.id);
                       }
                    }}
                    className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white w-full max-w-md p-6 rounded-2xl shadow-xl border border-stone-100">
              <h3 className="text-lg font-serif mb-6 text-stone-800">编辑语料</h3>
              <form onSubmit={handleSaveEdit} className="space-y-4">
                 <div>
                    <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1.5">英文表达</label>
                    <input 
                      type="text" 
                      value={editingItem.english}
                      onChange={e => setEditingItem({...editingItem, english: e.target.value})}
                      className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1.5">中文释义</label>
                    <input 
                      type="text" 
                      value={editingItem.chinese || ''}
                      onChange={e => setEditingItem({...editingItem, chinese: e.target.value})}
                      className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1.5">近义词 / 同义表达 (逗号分隔)</label>
                    <input 
                      type="text" 
                      value={(editingItem.synonyms || []).join(', ')}
                      onChange={e => setEditingItem({...editingItem, synonyms: e.target.value.split(',').map(t => t.trim()).filter(Boolean)})}
                      className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm"
                      placeholder="e.g. synonym1, synonym2"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1.5">标签 (逗号分隔)</label>
                    <input 
                      type="text" 
                      value={editingItem.tags.join(', ')}
                      onChange={e => setEditingItem({...editingItem, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean)})}
                      className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-800/10 focus:border-stone-400 transition-all text-sm"
                    />
                 </div>
                 <div className="flex justify-end gap-3 mt-8">
                    <Button type="button" variant="ghost" onClick={() => setEditingItem(null)}>取消</Button>
                    <Button type="submit">保存更改</Button>
                 </div>
              </form>
           </div>
        </div>
      )}
    </div>
  );
};
