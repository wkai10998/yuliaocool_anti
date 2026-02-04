
export interface CorpusItem {
  id: string;
  english: string;
  chinese: string; // Added Chinese definition
  type: 'phrase' | 'word' | 'sentence';
  tags: string[]; // e.g., 'business', 'casual', 'meeting'
  masteryLevel: number; // 0 to 5
  practiceCount?: number; // Total number of times practiced
  synonyms?: string[]; // List of alternative expressions
  nextReviewDate: number; // timestamp
  addedAt: number;
}

export interface CorpusExtractionResult {
  items: Array<{
    english: string;
    chinese: string;
    type: string;
    tags: string[];
    synonyms?: string[];
  }>;
}

export interface LearnContext {
  targetId: string;
  chineseContext: string;
  chineseHighlight: string; // The specific Chinese substring matching the target
  englishReference: string;
}

export interface ScenarioHighlight {
  text: string; // The EXACT substring used in the sentence (e.g., "scheduled")
  original?: string; // The canonical/dictionary form (e.g., "schedule")
  type: 'target' | 'new';
  explanation: string;
  translation?: string;
}

export interface ContextScenario {
  topic: string;
  chineseScript: string;
  englishReference: string;
  highlights: ScenarioHighlight[];
  chineseHighlights?: string[]; // Array of substrings in chineseScript to highlight
}

// Deprecated old ReviewMaterial, kept to prevent immediate break if cached, but unused in new logic
export interface ReviewMaterial {
  title: string;
  content: string;
  lines: string[];
}

export enum AppMode {
  DASHBOARD = 'DASHBOARD',
  LEARN = 'LEARN',
  REVIEW = 'REVIEW',
  CORPUS_MANAGER = 'CORPUS_MANAGER',
}
