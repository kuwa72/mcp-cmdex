export interface LLMConfig {
  enabled: boolean;
  model?: string;
  endpoint?: string;
  maxLength?: number;
  translateToEnglish?: boolean;
}

export interface ProcessResult {
  original: string;
  processed: string;
}

export interface LLMProcessor {
  summarize(text: string, maxLength?: number): Promise<string>;
  translateToEnglish(text: string): Promise<string>;
  process(text: string, config: LLMConfig): Promise<ProcessResult>;
}
