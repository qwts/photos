import { useEffect, useRef, type ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { useAnnouncer } from './LiveAnnouncer';

const messages = defineMessages({
  count: { id: 'shell.selection.count', defaultMessage: '{count, plural, one {# photo selected} other {# photos selected}}' },
  cleared: { id: 'shell.selection.cleared', defaultMessage: 'Selection cleared' },
});

export function SelectionAnnouncer({ count }: { readonly count: number }): ReactElement | null {
  const intl = useIntl();
  const { announce } = useAnnouncer();
  const previousCountRef = useRef(count);

  useEffect(() => {
    if (previousCountRef.current === count) return;
    previousCountRef.current = count;
    announce(count === 0 ? intl.formatMessage(messages.cleared) : intl.formatMessage(messages.count, { count }), 'polite', 'selection');
  }, [announce, count, intl]);

  return null;
}
