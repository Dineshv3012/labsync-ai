import { GoogleGenAI } from '@google/genai';

export interface AiRequest {
  system: string;
  prompt: string;
  json?: boolean;
  model?: string;
  maxOutputTokens?: number;
}
export interface AiProvider {
  configured: boolean;
  model: string;
  generate(req: AiRequest): Promise<string>;
}

export class AiProviderError extends Error {
  constructor(message: string, public kind: 'not_configured' | 'timeout' | 'upstream') {
    super(message);
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new AiProviderError('The AI service took too long to respond.', 'timeout')), ms))]);

export function createGeminiProvider(apiKey: string, model: string): AiProvider {
  if (!apiKey) {
    return {
      configured: false,
      model,
      async generate() {
        throw new AiProviderError('AI features are not configured. Set GEMINI_API_KEY on the server.', 'not_configured');
      },
    };
  }
  const client = new GoogleGenAI({ apiKey });
  return {
    configured: true,
    model,
    async generate(req) {
      try {
        const res = await withTimeout(
          client.models.generateContent({
            model: req.model || model,
            contents: req.prompt,
            config: {
              systemInstruction: req.system,
              maxOutputTokens: req.maxOutputTokens ?? 1024,
              ...(req.json ? { responseMimeType: 'application/json' } : {}),
            },
          }),
          30000,
        );
        return res.text ?? '';
      } catch (e: any) {
        if (e instanceof AiProviderError) throw e;
        throw new AiProviderError(`The AI provider returned an error${e?.status ? ` (${e.status})` : ''}.`, 'upstream');
      }
    },
  };
}
