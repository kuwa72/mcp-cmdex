import type { LLMProcessor, LLMConfig } from "./types.ts";
import { NullLLMProcessor } from "./null-processor.ts";
import { OllamaProcessor } from "./ollama-processor.ts";

export function createLLMProcessor(config: LLMConfig): LLMProcessor {
  if (!config.enabled) {
    return new NullLLMProcessor();
  }

  return new OllamaProcessor();
}
