import type { ReactElement } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import type { QuickActionCommandId, QuickActionIcon } from '../../../shared/commands/registry.js';
import { Icon } from '../components/Icon';

import './quick-actions.css';

export interface QuickActionItem {
  readonly id: QuickActionCommandId;
  readonly label: string;
  readonly icon: QuickActionIcon;
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly targetLabel: string;
}

export interface QuickActionsProps {
  readonly photoName: string;
  readonly items: readonly QuickActionItem[];
  readonly onInvoke: (id: QuickActionCommandId) => void;
}

const messages = defineMessages({
  toolbar: { id: 'library.quickActions.toolbar', defaultMessage: 'Quick Actions for {photo}' },
  actionLabel: { id: 'library.quickActions.actionLabel', defaultMessage: '{action}. {target}' },
  disabledActionLabel: {
    id: 'library.quickActions.disabledActionLabel',
    defaultMessage: '{action}. {target}. {reason}',
  },
  tooltip: { id: 'library.quickActions.tooltip', defaultMessage: '{action} · {target}' },
  disabledTooltip: { id: 'library.quickActions.disabledTooltip', defaultMessage: '{action} · {reason}' },
  targetPair: { id: 'library.quickActions.targetPair', defaultMessage: '{first} / {second}' },
});

export function QuickActions({ photoName, items, onInvoke }: QuickActionsProps): ReactElement {
  const intl = useIntl();
  const targetLabels = [...new Set(items.map(({ targetLabel }) => targetLabel))];
  const targets =
    targetLabels.length > 1
      ? intl.formatMessage(messages.targetPair, { first: targetLabels[0], second: targetLabels[1] })
      : (targetLabels[0] ?? '');
  return (
    <div className="ovl-quick-actions" role="toolbar" aria-label={intl.formatMessage(messages.toolbar, { photo: photoName })}>
      <span className="ovl-quick-actions__target mono-data">{targets}</span>
      <div className="ovl-quick-actions__buttons">
        {items.map((item) => (
          <span
            key={item.id}
            className="ovl-quick-actions__button-wrap"
            title={intl.formatMessage(item.reason === null ? messages.tooltip : messages.disabledTooltip, {
              action: item.label,
              target: item.targetLabel,
              reason: item.reason,
            })}
          >
            <button
              type="button"
              disabled={!item.enabled}
              aria-label={intl.formatMessage(item.reason === null ? messages.actionLabel : messages.disabledActionLabel, {
                action: item.label,
                target: item.targetLabel,
                reason: item.reason,
              })}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onInvoke(item.id);
              }}
            >
              <Icon name={item.icon} size={15} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
