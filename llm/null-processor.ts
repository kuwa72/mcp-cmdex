import type { LLMProcessor, LLMConfig, ProcessResult } from "./types.ts";

// Null Objectパターンの実装
export class NullLLMProcessor implements LLMProcessor {
  summarize(text: string): Promise<string> {
    return Promise.resolve(text);
  }

  translateToEnglish(text: string): Promise<string> {
    return Promise.resolve(text);
  }

  process(text: string, _config: LLMConfig): Promise<ProcessResult> {
    return Promise.resolve({
      original: text,
      processed: text
    });
  }
}
