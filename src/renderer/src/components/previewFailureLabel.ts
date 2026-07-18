import { defineMessages, type IntlShape } from 'react-intl';

import type { PreviewFailureReason } from '../../../shared/library/preview.js';

const messages = defineMessages({
  generic: { id: 'preview.unavailable', defaultMessage: 'PREVIEW UNAVAILABLE' },
  corrupt: { id: 'preview.unavailable.corrupt', defaultMessage: 'PREVIEW UNAVAILABLE — FILE IS CORRUPT' },
  unsupportedCodec: {
    id: 'preview.unavailable.unsupportedCodec',
    defaultMessage: 'PREVIEW UNAVAILABLE — HEIC CODEC IS UNSUPPORTED',
  },
  decodeFailed: { id: 'preview.unavailable.decodeFailed', defaultMessage: 'PREVIEW UNAVAILABLE — IMAGE DECODE FAILED' },
});

export function previewFailureLabel(intl: IntlShape, failure: PreviewFailureReason | null | undefined): string {
  if (failure === 'corrupt') return intl.formatMessage(messages.corrupt);
  if (failure === 'unsupported-codec') return intl.formatMessage(messages.unsupportedCodec);
  if (failure === 'decode-failed') return intl.formatMessage(messages.decodeFailed);
  return intl.formatMessage(messages.generic);
}
