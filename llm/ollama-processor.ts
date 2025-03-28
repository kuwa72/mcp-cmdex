import { ChatOllama } from "@langchain/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { LLMProcessor, LLMConfig, ProcessResult } from "./types.ts";

export class OllamaProcessor implements LLMProcessor {
  private readonly model: ChatOllama;

  constructor(endpoint = "http://localhost:11434", modelName = "deepseek-r1:8b") {
    this.model = new ChatOllama({
      baseUrl: endpoint,
      model: modelName,
    });
  }

  async summarize(text: string, maxLength?: number): Promise<string> {
    const prompt = ChatPromptTemplate.fromTemplate(`
以下のテキストを要約してください。${maxLength ? `${maxLength}文字以内で回答してください。` : ""}
要約のルール：
- 重要な情報を優先
- 簡潔に
- 箇条書き形式

テキスト:
{text}
    `);

    const chain = prompt.pipe(this.model);
    const response = await chain.invoke({
      text,
    });

    return response.content.toString();
  }

  async translateToEnglish(text: string): Promise<string> {
    const prompt = ChatPromptTemplate.fromTemplate(`
Translate the following Japanese text to English.
Keep the same meaning and nuance.
Text to translate:
{text}
    `);

    const chain = prompt.pipe(this.model);
    const response = await chain.invoke({
      text,
    });

    return response.content.toString();
  }

  async process(text: string, config: LLMConfig): Promise<ProcessResult> {
    let processed = text;

      processed = await this.summarize(processed);
      processed = await this.translateToEnglish(processed);

    return {
      original: text,
      processed,
    };
  }
}
