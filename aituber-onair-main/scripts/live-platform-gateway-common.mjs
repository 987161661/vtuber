import { createHash } from 'node:crypto';

const COMMENT_DEDUPLICATION_MS = 2 * 60_000;

export function splitLiveChatText(input, maxLength = 20) {
  const normalized = String(input || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const limit = Math.max(1, Math.min(100, Number(maxLength) || 1));
  const remaining = Array.from(normalized);
  const chunks = [];
  const boundary = /[，。！？；、,.!?;\s]/;
  while (remaining.length > limit) {
    let end = limit;
    for (let index = limit - 1; index >= Math.floor(limit / 2); index -= 1) {
      if (boundary.test(remaining[index])) {
        end = index + 1;
        break;
      }
    }
    chunks.push(remaining.splice(0, end).join('').trim());
  }
  const tail = remaining.join('').trim();
  if (tail) chunks.push(tail);
  return chunks.filter(Boolean);
}

export class LiveEventHub {
  clients = new Set();
  clientsByKey = new Map();
  clientKeys = new Map();
  deliveredIdsByKey = new Map();
  recentIds = new Map();
  recentFingerprints = new Map();
  recentEvents = [];

  add(response, lastEventId = '', clientKey = '', currentStatus = {}) {
    if (clientKey) {
      const previous = this.clientsByKey.get(clientKey);
      if (previous && previous !== response) {
        this.clients.delete(previous);
        previous.end();
      }
      this.clientsByKey.set(clientKey, response);
      this.clientKeys.set(response, clientKey);
    }
    this.clients.add(response);
    response.write(this.serialize('status', currentStatus));
    const lastIndex = lastEventId
      ? this.recentEvents.findIndex((item) => item.event.id === lastEventId)
      : -1;
    const delivered = clientKey
      ? this.deliveredIdsByKey.get(clientKey) || new Set()
      : new Set();
    if (clientKey) this.deliveredIdsByKey.set(clientKey, delivered);
    const replayCandidates =
      lastIndex >= 0
        ? this.recentEvents.slice(lastIndex + 1)
        : lastEventId && clientKey
          ? this.recentEvents.filter(
              (item) => Date.now() - item.receivedAt <= 2 * 60_000,
            )
          : [];
    for (const item of replayCandidates) {
      if (delivered.has(item.event.id)) continue;
      response.write(this.serialize('room-event', item.event, item.event.id));
      delivered.add(item.event.id);
    }
  }

  remove(response) {
    this.clients.delete(response);
    this.clientKeys.delete(response);
    for (const [key, client] of this.clientsByKey) {
      if (client === response) this.clientsByKey.delete(key);
    }
  }

  serialize(event, data, id = '') {
    const safeId = String(id).replace(/[\r\n]/g, '');
    return `${safeId ? `id: ${safeId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  publish(event, data, id = '') {
    const serialized = this.serialize(event, data, id);
    for (const client of this.clients) client.write(serialized);
  }

  publishRoomEvent(event) {
    const now = Date.now();
    const fingerprint = createHash('sha256')
      .update(
        `${event.type}:${event.author?.id || event.author?.name}:${String(event.text || '').trim().toLowerCase()}`,
      )
      .digest('hex');
    const seenAt = this.recentFingerprints.get(fingerprint) || 0;
    if (
      this.recentIds.has(event.id) ||
      (seenAt > 0 && now - seenAt < COMMENT_DEDUPLICATION_MS)
    ) {
      return false;
    }
    event.metadata = {
      ...event.metadata,
      receivedAt: Number(event.metadata?.receivedAt) || now,
    };
    this.recentIds.set(event.id, now);
    this.recentFingerprints.set(fingerprint, now);
    this.recentEvents.push({ event, receivedAt: now });
    if (this.recentEvents.length > 200) this.recentEvents.shift();
    const serialized = this.serialize('room-event', event, event.id);
    for (const client of this.clients) {
      client.write(serialized);
      const clientKey = this.clientKeys.get(client);
      if (!clientKey) continue;
      const delivered = this.deliveredIdsByKey.get(clientKey) || new Set();
      delivered.add(event.id);
      while (delivered.size > 2000) delivered.delete(delivered.values().next().value);
      this.deliveredIdsByKey.set(clientKey, delivered);
    }
    if (this.recentIds.size > 2000) {
      for (const [id, timestamp] of this.recentIds) {
        if (now - timestamp > 10 * 60_000) this.recentIds.delete(id);
      }
    }
    return true;
  }
}
