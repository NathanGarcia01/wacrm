import Anthropic from "@anthropic-ai/sdk";

// Lazy singleton — reads ANTHROPIC_API_KEY from the environment, same
// convention as src/lib/flows/admin-client.ts for the Supabase admin client.
let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

/**
 * Strips a ```json ... ``` fence if the model wrapped its answer in one,
 * despite being told to return raw JSON. Cheap insurance against the
 * occasional markdown habit.
 */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}
