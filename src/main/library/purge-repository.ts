import type { PhotosRepository } from '../db/photos-repository.js';
import type { PurgeDeps } from './purge-service.js';

export function createPurgeRepository(repo: PhotosRepository): PurgeDeps['repo'] {
  return {
    getDeleted: (id) => repo.getDeleted(id),
    getAny: (id) => repo.get(id),
    purgeRow: (id) => repo.purgeRow(id),
    purgeRowAuthorized: (id) => repo.purgeRowAuthorized(id),
    countAnyByContentHash: (hash) => repo.countAnyByContentHash(hash),
    expiredDeleted: (cutoff) => repo.expiredDeleted(cutoff),
  };
}
