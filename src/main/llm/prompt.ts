import type { LlmDisplayContext } from './provider.js';

// Shared prompt shaping for photo Q&A across every provider, so answers and
// token counts stay comparable. The system prompt keeps replies grounded in
// the single image the user selected; the composed user prompt appends only
// the display context ADR-0018 §7 permits (taken-at date, camera model).

export const SYSTEM_PROMPT =
  'You are helping the user understand a single photo from their own library. ' +
  'Answer their question concisely, based only on the attached image and the context provided. ' +
  'If the image does not show what is asked, say so plainly rather than guessing.';

export function composePrompt(prompt: string, context?: LlmDisplayContext): string {
  const lines: string[] = [];
  if (context?.takenAt !== undefined && context.takenAt !== '') {
    lines.push(`Taken: ${context.takenAt}`);
  }
  if (context?.cameraModel !== undefined && context.cameraModel !== '') {
    lines.push(`Camera: ${context.cameraModel}`);
  }
  const contextBlock = lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
  return `${contextBlock}${prompt}`;
}
