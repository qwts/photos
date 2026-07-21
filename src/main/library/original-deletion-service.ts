import { randomUUID } from 'node:crypto';

import type { AppLockState, AppAuthorizationResult } from '../crypto/app-lock-controller.js';
import type { PurgeSummary } from './purge-service.js';
import type { PhotoRecord } from '../../shared/library/types.js';

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

interface Challenge {
  readonly libraryId: string;
  readonly authorizationEpoch: number;
  readonly photoIds: readonly string[];
  readonly originalStates: readonly boolean[];
  readonly expiresAt: number;
  readonly passwordRequired: boolean;
  authorized: boolean;
}

export interface OriginalDeletionServiceOptions {
  readonly getPhoto: (photoId: string) => PhotoRecord | undefined;
  readonly activeLibraryId: () => string;
  readonly authorizationEpoch: () => number;
  readonly lockState: () => AppLockState;
  readonly authorizePassword: (password: string) => Promise<AppAuthorizationResult>;
  readonly deletePermanently: (photoIds: readonly string[]) => Promise<PurgeSummary>;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export class OriginalDeletionService {
  private readonly challenges = new Map<string, Challenge>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly options: OriginalDeletionServiceOptions) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
  }

  preflight(photoIds: readonly string[]): {
    readonly challengeId: string;
    readonly count: number;
    readonly protected: number;
    readonly fileName: string | null;
    readonly passwordRequired: boolean;
    readonly expiresAt: string;
  } {
    const state = this.options.lockState();
    if (state !== 'unlocked' && state !== 'unconfigured-unlocked') throw new Error('app is locked');
    const ids = [...new Set(photoIds)].sort();
    const photos = ids.map((id) => this.options.getPhoto(id));
    if (photos.some((photo) => photo === undefined)) throw new Error('selection changed; reopen the deletion ceremony');
    const present = photos as PhotoRecord[];
    const protectedCount = present.filter(({ isOriginal }) => isOriginal).length;
    if (protectedCount === 0) throw new Error('selection contains no protected Originals');
    // Only the latest visible ceremony is authoritative. This also bounds
    // abandoned preflights from renderer teardown to one short-lived entry.
    this.challenges.clear();
    const challengeId = this.newId();
    const expiresAt = this.now() + CHALLENGE_TTL_MS;
    const passwordRequired = state === 'unlocked';
    this.challenges.set(challengeId, {
      libraryId: this.options.activeLibraryId(),
      authorizationEpoch: this.options.authorizationEpoch(),
      photoIds: ids,
      originalStates: present.map(({ isOriginal }) => isOriginal),
      expiresAt,
      passwordRequired,
      authorized: !passwordRequired,
    });
    return {
      challengeId,
      count: ids.length,
      protected: protectedCount,
      fileName: ids.length === 1 ? (present[0]?.fileName ?? null) : null,
      passwordRequired,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async authorize(challengeId: string, password: string): Promise<AppAuthorizationResult> {
    const challenge = this.requireFresh(challengeId);
    if (!challenge.passwordRequired) return { ok: true };
    const result = await this.options.authorizePassword(password);
    if (result.ok) challenge.authorized = true;
    return result;
  }

  async commit(challengeId: string): Promise<PurgeSummary> {
    const challenge = this.requireFresh(challengeId);
    if (!challenge.authorized) throw new Error('password authorization is required');
    if (this.options.lockState() !== (challenge.passwordRequired ? 'unlocked' : 'unconfigured-unlocked')) {
      throw new Error('app lock state changed; reopen the deletion ceremony');
    }
    const photos = challenge.photoIds.map((id) => this.options.getPhoto(id));
    const stale = photos.some((photo, index) => photo === undefined || photo.isOriginal !== challenge.originalStates[index]);
    if (stale) throw new Error('selection changed; reopen the deletion ceremony');
    this.challenges.delete(challengeId);
    return this.options.deletePermanently(challenge.photoIds);
  }

  cancel(challengeId: string): void {
    this.challenges.delete(challengeId);
  }

  private requireFresh(challengeId: string): Challenge {
    const challenge = this.challenges.get(challengeId);
    if (challenge === undefined) throw new Error('deletion authorization is unavailable');
    if (
      challenge.expiresAt < this.now() ||
      challenge.libraryId !== this.options.activeLibraryId() ||
      challenge.authorizationEpoch !== this.options.authorizationEpoch()
    ) {
      this.challenges.delete(challengeId);
      throw new Error('deletion authorization expired');
    }
    return challenge;
  }
}
