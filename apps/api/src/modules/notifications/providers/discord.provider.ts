/**
 * Native Discord Webhook Notification Provider.
 *
 * Delivers Stellar payment and contract alerts as rich Discord embeds:
 * - Severity-based embed colors
 * - Amount, Asset, From, To and Hash fields
 * - Clickable Stellar Expert transaction/contract links
 * - Dynamic asset icons for XLM, USDC and EURC
 * - Exponential backoff retries plus Discord rate-limit handling
 *   (`429`, `X-RateLimit-Reset`, `Retry-After`, `retry_after`)
 */

import { env } from '../../../config/env';
import { fetchWithTimeout } from '../../../lib/external-request';

export type DiscordAlertType = 'payment' | 'contract';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
}

export interface DiscordEmbedThumbnail {
  url: string;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields: DiscordEmbedField[];
  timestamp: string;
  footer?: DiscordEmbedFooter;
  thumbnail?: DiscordEmbedThumbnail;
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions?: { parse: string[] };
}

export interface DiscordAlertInput {
  paymentId?: string;
  alertId?: string;
  type?: DiscordAlertType;
  txHash: string;
  amount?: string | number;
  asset?: string;
  assetIssuer?: string | null;
  fromAddress?: string;
  recipientAddress?: string;
  contractId?: string;
  eventType?: string;
  memo?: string;
  severity?: string | null;
  title?: string;
  description?: string;
  receivedAt: string | Date;
  network?: string;
  dashboardBaseUrl?: string;
  explorerBaseUrl?: string;
}

export type DiscordPaymentAlert = DiscordAlertInput;

export interface DiscordDispatchTarget {
  webhookUrl?: string | null;
}

export interface DiscordDispatchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  username?: string;
  avatarUrl?: string;
}

export interface DiscordDispatchResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  rateLimited?: boolean;
  retryAfterSeconds?: number;
  attempts?: number;
}

/**
 * Discord embed colors, mapped from alert severity.
 * @see https://discord.com/developers/docs/resources/channel#embed-object-embed-structure
 */
export const DISCORD_EMBED_COLORS: Record<string, number> = {
  critical: 0xed4245,
  fatal: 0xed4245,
  error: 0xe74c3c,
  high: 0xe67e22,
  warning: 0xfee75c,
  medium: 0xf0b232,
  info: 0x5865f2,
  low: 0x57f287,
  success: 0x57f287,
  default: 0x5865f2,
};

/**
 * Common Stellar asset icons. Keys are normalized upper-case asset codes.
 */
export const STELLAR_ASSET_ICONS: Record<string, string> = {
  XLM: 'https://cryptologos.cc/logos/stellar-xlm-logo.png',
  USDC: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
  EURC: 'https://cryptologos.cc/logos/euro-coin-eurc-logo.png',
};

const ASSET_EMOJIS: Record<string, string> = {
  XLM: '🌟',
  USDC: '💵',
  EURC: '💶',
};

export const DISCORD_EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
} as const;

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60_000;

/**
 * Extract the asset code from either a bare code ("USDC") or an
 * issuer-qualified asset ("USDC:GA...", "USDC-GA...").
 */
export function normalizeAssetCode(asset?: string | null): string | undefined {
  if (!asset) return undefined;
  const code = asset.trim().split(/[:\-]/)[0]?.toUpperCase();
  return code || undefined;
}

/**
 * Resolve a canonical icon URL for well-known Stellar assets.
 */
export function resolveAssetIcon(asset?: string | null): string | undefined {
  const code = normalizeAssetCode(asset);
  if (!code) return undefined;
  return STELLAR_ASSET_ICONS[code];
}

/**
 * Build a Stellar Expert transaction link for the given network.
 */
export function getStellarExpertTxLink(txHash: string, network?: string): string {
  const base =
    network === 'testnet'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';
  return `${base}/tx/${encodeURIComponent(txHash)}`;
}

function truncateMiddle(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function truncateField(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function formatAssetBadge(asset: string, assetIssuer?: string | null): string {
  const code = normalizeAssetCode(asset) ?? asset;
  const emoji = ASSET_EMOJIS[code] ?? '🪙';
  if (!assetIssuer) return `${emoji} ${code}`;
  return `${emoji} ${code} (${truncateMiddle(assetIssuer, 4, 4)})`;
}

function resolveSeverityColor(severity?: string | null): number {
  const key = (severity || 'default').toLowerCase().trim();
  return DISCORD_EMBED_COLORS[key] ?? DISCORD_EMBED_COLORS.default;
}

export class DiscordNotificationProvider {
  /**
   * Validate an incoming Discord webhook URL.
   */
  isValidWebhookUrl(url?: string | null): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com') &&
        parsed.pathname.startsWith('/api/webhooks/')
      );
    } catch {
      return false;
    }
  }

  /**
   * Build a single rich embed card for a payment or contract alert.
   */
  buildEmbed(data: DiscordAlertInput): DiscordEmbed {
    const isContract = data.type === 'contract' || (!data.amount && Boolean(data.contractId));
    const explorerBase = this.resolveExplorerBase(data);
    const txUrl = `${explorerBase}/tx/${encodeURIComponent(data.txHash)}`;
    const alertId = data.alertId || data.paymentId;

    const fields: DiscordEmbedField[] = [];

    if (data.severity) {
      fields.push({
        name: 'Severity',
        value: `**${data.severity.toUpperCase()}**`,
        inline: true,
      });
    }

    if (data.amount !== undefined && data.amount !== null) {
      const suffix = data.asset ? ` ${data.asset}` : '';
      fields.push({
        name: 'Amount',
        value: truncateField(`\`${data.amount}${suffix}\``, DISCORD_EMBED_LIMITS.fieldValue),
        inline: true,
      });
    }

    if (data.asset) {
      fields.push({
        name: 'Asset',
        value: truncateField(
          formatAssetBadge(data.asset, data.assetIssuer),
          DISCORD_EMBED_LIMITS.fieldValue,
        ),
        inline: true,
      });
    }

    if (data.fromAddress) {
      fields.push({
        name: 'From',
        value: truncateField(`\`${data.fromAddress}\``, DISCORD_EMBED_LIMITS.fieldValue),
        inline: false,
      });
    }

    if (data.recipientAddress) {
      fields.push({
        name: 'To',
        value: truncateField(`\`${data.recipientAddress}\``, DISCORD_EMBED_LIMITS.fieldValue),
        inline: false,
      });
    }

    if (data.contractId) {
      fields.push({
        name: 'Contract',
        value: truncateField(
          `[\`${truncateMiddle(data.contractId)}\`](${explorerBase}/contract/${encodeURIComponent(data.contractId)})`,
          DISCORD_EMBED_LIMITS.fieldValue,
        ),
        inline: false,
      });
    }

    if (data.eventType) {
      fields.push({
        name: 'Event',
        value: truncateField(data.eventType, DISCORD_EMBED_LIMITS.fieldValue),
        inline: true,
      });
    }

    fields.push({
      name: 'Hash',
      value: `[\`${truncateMiddle(data.txHash)}\`](${txUrl})`,
      inline: false,
    });

    if (data.memo) {
      fields.push({
        name: 'Memo',
        value: truncateField(data.memo, DISCORD_EMBED_LIMITS.fieldValue),
        inline: false,
      });
    }

    const receivedAt =
      data.receivedAt instanceof Date ? data.receivedAt : new Date(data.receivedAt);
    const timestamp = Number.isNaN(receivedAt.getTime())
      ? new Date().toISOString()
      : receivedAt.toISOString();

    const networkLabel =
      (data.network || 'public') === 'testnet' ? 'Stellar Testnet' : 'Stellar Public Network';
    const footerParts = [networkLabel];
    if (alertId) footerParts.push(`Alert ${alertId}`);
    if (data.severity) footerParts.push(data.severity.toUpperCase());

    const title =
      data.title ||
      (isContract ? '📜 Stellar Contract Alert' : '💸 Stellar Payment Received');

    const embed: DiscordEmbed = {
      title: truncateField(title, DISCORD_EMBED_LIMITS.title),
      color: resolveSeverityColor(data.severity),
      fields: fields.slice(0, DISCORD_EMBED_LIMITS.fields),
      timestamp,
      url: txUrl,
      footer: {
        text: truncateField(footerParts.join(' • '), DISCORD_EMBED_LIMITS.footer),
      },
    };

    if (data.description) {
      embed.description = truncateField(data.description, DISCORD_EMBED_LIMITS.description);
    }

    const icon = resolveAssetIcon(data.asset);
    if (icon) {
      embed.thumbnail = { url: icon };
    }

    return embed;
  }

  /**
   * Build the complete Discord webhook payload for an alert.
   */
  buildWebhookPayload(
    data: DiscordAlertInput,
    options: { username?: string; avatarUrl?: string } = {},
  ): DiscordWebhookPayload {
    const payload: DiscordWebhookPayload = {
      username: options.username || 'Stellar Alerts',
      embeds: [this.buildEmbed(data)],
      allowed_mentions: { parse: [] },
    };

    if (options.avatarUrl) {
      payload.avatar_url = options.avatarUrl;
    }

    return payload;
  }

  /**
   * Dispatch an alert to a Discord webhook with retries and rate-limit handling.
   */
  async dispatch(
    target: DiscordDispatchTarget,
    data: DiscordAlertInput,
    options: DiscordDispatchOptions = {},
  ): Promise<DiscordDispatchResult> {
    const webhookUrl = target.webhookUrl?.trim();
    if (!webhookUrl) {
      return { success: false, error: 'Discord webhook URL is required' };
    }

    const payload = this.buildWebhookPayload(data, {
      username: options.username,
      avatarUrl: options.avatarUrl,
    });

    return this.sendWebhook(webhookUrl, payload, options);
  }

  /**
   * POST a webhook payload, retrying transient failures with exponential
   * backoff and honoring Discord's rate-limit reset headers.
   */
  async sendWebhook(
    webhookUrl: string,
    payload: DiscordWebhookPayload,
    options: DiscordDispatchOptions = {},
  ): Promise<DiscordDispatchResult> {
    if (!this.isValidWebhookUrl(webhookUrl)) {
      return { success: false, error: 'Invalid Discord webhook URL' };
    }

    const timeoutMs = options.timeoutMs ?? env.NOTIFICATION_PROVIDER_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseRetryDelayMs = options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
    const maxRetryDelayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
    );

    let lastResult: DiscordDispatchResult = {
      success: false,
      error: 'Discord dispatch did not run',
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastResult = await this.sendOnce(webhookUrl, payload, timeoutMs, options.signal);
      lastResult.attempts = attempt + 1;

      if (lastResult.success) {
        return lastResult;
      }

      const isRetryable =
        lastResult.rateLimited ||
        lastResult.statusCode === 429 ||
        (lastResult.statusCode !== undefined && lastResult.statusCode >= 500) ||
        lastResult.statusCode === undefined;

      if (!isRetryable || attempt === maxRetries) {
        return lastResult;
      }

      const backoffMs = Math.min(
        maxRetryDelayMs,
        baseRetryDelayMs * Math.pow(2, attempt),
      );
      const retryAfterMs =
        lastResult.rateLimited && lastResult.retryAfterSeconds !== undefined
          ? Math.ceil(lastResult.retryAfterSeconds * 1000)
          : 0;

      await this.sleep(Math.min(maxRetryDelayMs, Math.max(backoffMs, retryAfterMs)), options.signal);
    }

    return lastResult;
  }

  private resolveExplorerBase(data: DiscordAlertInput): string {
    if (data.explorerBaseUrl) {
      return data.explorerBaseUrl.replace(/\/+$/, '');
    }
    return data.network === 'testnet'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';
  }

  private async sendOnce(
    webhookUrl: string,
    payload: DiscordWebhookPayload,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<DiscordDispatchResult> {
    try {
      const response = await fetchWithTimeout(
        webhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        timeoutMs,
        signal,
        'Discord',
      );

      if (response.status === 429) {
        const retryAfterSeconds = await this.parseRetryAfter(response);
        return {
          success: false,
          statusCode: 429,
          rateLimited: true,
          retryAfterSeconds,
          error: `Discord webhook rate limited (429); retry after ${
            retryAfterSeconds ?? 'unknown'
          }s`,
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          statusCode: response.status,
          error: `Discord webhook responded with HTTP ${response.status}: ${errorText}`,
        };
      }

      return { success: true, statusCode: response.status };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to dispatch Discord webhook',
      };
    }
  }

  /**
   * Discord rate-limit responses can carry the reset time in
   * `X-RateLimit-Reset` (Unix seconds), `Retry-After` (seconds), or the JSON
   * body (`retry_after`, seconds). Prefer the most specific header first.
   */
  private async parseRetryAfter(response: Response): Promise<number | undefined> {
    const resetHeader = response.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const reset = Number(resetHeader);
      if (Number.isFinite(reset) && reset > 0) {
        const resetMs = reset > 1_000_000_000_000 ? reset : reset * 1000;
        const secondsUntilReset = (resetMs - Date.now()) / 1000;
        if (secondsUntilReset > 0) {
          return secondsUntilReset;
        }
      }
    }

    const retryAfterHeader = response.headers.get('retry-after');
    if (retryAfterHeader) {
      const retryAfter = Number(retryAfterHeader);
      if (Number.isFinite(retryAfter) && retryAfter >= 0) {
        return retryAfter;
      }
    }

    try {
      const body = (await response.json()) as { retry_after?: unknown };
      const retryAfter = Number(body?.retry_after);
      if (Number.isFinite(retryAfter) && retryAfter >= 0) {
        return retryAfter;
      }
    } catch {
      // Body is not JSON; fall through to "unknown retry".
    }

    return undefined;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clean();
        resolve();
      }, ms);
      const onAbort = () => {
        clean();
        reject(new Error('Discord retry aborted'));
      };
      const clean = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      if (signal) {
        if (signal.aborted) {
          clean();
          reject(new Error('Discord retry aborted'));
          return;
        }
        signal.addEventListener('abort', onAbort);
      }
    });
  }
}

export const discordNotificationProvider = new DiscordNotificationProvider();
