export interface Photo {
  readonly id: string;
  readonly title: string;
}

export function describePhoto(photo: Photo): string {
  return `${photo.title} (${photo.id})`;
}
