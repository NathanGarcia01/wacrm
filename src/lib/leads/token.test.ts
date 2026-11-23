import { describe, expect, it } from 'vitest';

import { generateLeadSourceToken, hashLeadSourceToken, leadWebhookUrl } from './token';

describe('generateLeadSourceToken', () => {
  it('returns a plaintext token whose hash matches hashLeadSourceToken', () => {
    const { token, hash } = generateLeadSourceToken();
    expect(hashLeadSourceToken(token)).toBe(hash);
  });

  it('produces a different token (and hash) on every call', () => {
    const a = generateLeadSourceToken();
    const b = generateLeadSourceToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it('is URL-safe (no characters that need escaping in a path segment)', () => {
    const { token } = generateLeadSourceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashLeadSourceToken', () => {
  it('is deterministic', () => {
    expect(hashLeadSourceToken('abc')).toBe(hashLeadSourceToken('abc'));
  });

  it('is sensitive to the full input, not just a prefix', () => {
    expect(hashLeadSourceToken('abc')).not.toBe(hashLeadSourceToken('abd'));
  });
});

describe('leadWebhookUrl', () => {
  it('builds the public webhook path from a base URL and token', () => {
    expect(leadWebhookUrl('tok123', 'https://crm.example.com')).toBe(
      'https://crm.example.com/api/v1/webhooks/in/tok123',
    );
  });

  it('tolerates a trailing slash on the base URL', () => {
    expect(leadWebhookUrl('tok123', 'https://crm.example.com/')).toBe(
      'https://crm.example.com/api/v1/webhooks/in/tok123',
    );
  });
});
