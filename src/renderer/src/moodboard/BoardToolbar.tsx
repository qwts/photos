import { useState } from 'react';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';

import type { AlignEdge, DistributeAxis } from '../../../shared/moodboard/geometry.js';
import type { IconName } from '../components/Icon';
import { Icon } from '../components/Icon';
import { moodboardMessages } from './messages';

// Floating board toolbar (#693): an APG-style toolbar of icon buttons plus an
// align/distribute popover. Every board pointer gesture is reachable here by
// keyboard (invariant I5) — the bar is one Tab stop group and the align menu is
// keyboard-operable.
export interface BoardToolbarProps {
  readonly zoom: number;
  readonly cropMode: boolean;
  readonly canGroup: boolean;
  readonly canUngroup: boolean;
  readonly hasSelection: boolean;
  readonly onAdd: () => void;
  readonly onAlign: (edge: AlignEdge) => void;
  readonly onDistribute: (axis: DistributeAxis) => void;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
  readonly onBringForward: () => void;
  readonly onSendBack: () => void;
  readonly onToggleCrop: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
  readonly onExport: () => void;
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className="ovl-moodboard__tool"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={16} color="currentColor" />
    </button>
  );
}

export function BoardToolbar(props: BoardToolbarProps): ReactElement {
  const intl = useIntl();
  const [alignOpen, setAlignOpen] = useState(false);
  const align = (edge: AlignEdge): void => {
    props.onAlign(edge);
    setAlignOpen(false);
  };
  const distribute = (axis: DistributeAxis): void => {
    props.onDistribute(axis);
    setAlignOpen(false);
  };
  const zoomLabel = `${Math.round(props.zoom * 100)}%`;

  return (
    <>
      {alignOpen ? (
        <div className="ovl-moodboard__align-menu" role="group" aria-label={intl.formatMessage(moodboardMessages.align)}>
          <button type="button" onClick={() => align('left')}>
            <FormattedMessage {...moodboardMessages.alignLeft} />
          </button>
          <button type="button" onClick={() => align('hcenter')}>
            <FormattedMessage {...moodboardMessages.alignCenter} />
          </button>
          <button type="button" onClick={() => align('right')}>
            <FormattedMessage {...moodboardMessages.alignRight} />
          </button>
          <button type="button" onClick={() => align('top')}>
            <FormattedMessage {...moodboardMessages.alignTop} />
          </button>
          <button type="button" onClick={() => align('vmiddle')}>
            <FormattedMessage {...moodboardMessages.alignMiddle} />
          </button>
          <button type="button" onClick={() => align('bottom')}>
            <FormattedMessage {...moodboardMessages.alignBottom} />
          </button>
          <button type="button" onClick={() => distribute('horizontal')}>
            <FormattedMessage {...moodboardMessages.distributeH} />
          </button>
          <button type="button" onClick={() => distribute('vertical')}>
            <FormattedMessage {...moodboardMessages.distributeV} />
          </button>
        </div>
      ) : null}
      <div className="ovl-moodboard__toolbar" role="toolbar" aria-label={intl.formatMessage(moodboardMessages.toolbarLabel)}>
        <ToolButton icon="plus" label={intl.formatMessage(moodboardMessages.add)} onClick={props.onAdd} />
        <ToolButton
          icon="align-horizontal-justify-center"
          label={intl.formatMessage(moodboardMessages.align)}
          pressed={alignOpen}
          disabled={!props.hasSelection}
          onClick={() => setAlignOpen((open) => !open)}
        />
        <ToolButton
          icon="group"
          label={intl.formatMessage(props.canUngroup ? moodboardMessages.ungroup : moodboardMessages.group)}
          disabled={!props.canGroup && !props.canUngroup}
          onClick={props.canUngroup ? props.onUngroup : props.onGroup}
        />
        <ToolButton
          icon="bring-to-front"
          label={intl.formatMessage(moodboardMessages.bringForward)}
          disabled={!props.hasSelection}
          onClick={props.onBringForward}
        />
        <ToolButton
          icon="send-to-back"
          label={intl.formatMessage(moodboardMessages.sendBack)}
          disabled={!props.hasSelection}
          onClick={props.onSendBack}
        />
        <ToolButton
          icon="crop"
          label={intl.formatMessage(moodboardMessages.crop)}
          pressed={props.cropMode}
          disabled={!props.hasSelection}
          onClick={props.onToggleCrop}
        />
        <span className="ovl-moodboard__toolbar-sep" aria-hidden />
        <ToolButton icon="zoom-out" label={intl.formatMessage(moodboardMessages.zoomOut)} onClick={props.onZoomOut} />
        <span className="ovl-moodboard__zoom-readout mono-data">{zoomLabel}</span>
        <ToolButton icon="zoom-in" label={intl.formatMessage(moodboardMessages.zoomIn)} onClick={props.onZoomIn} />
        <ToolButton icon="maximize-2" label={intl.formatMessage(moodboardMessages.fit)} onClick={props.onFit} />
        <span className="ovl-moodboard__toolbar-sep" aria-hidden />
        <ToolButton icon="share" label={intl.formatMessage(moodboardMessages.exportBoard)} onClick={props.onExport} />
      </div>
    </>
  );
}
