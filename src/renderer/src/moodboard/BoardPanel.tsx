import type { ChangeEvent, ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';

import type { Board, BoardBackground, BoardSize, Placement } from '../../../shared/moodboard/board.js';
import { BOARD_BACKGROUNDS, BOARD_SIZE_PRESETS } from '../../../shared/moodboard/board.js';
import { moodboardMessages } from './messages';

// Board-settings panel (#693): title, notes, board size, placement count,
// selected transform, and background tone. Native label+input controls; machine
// data uses .mono-data. Changing the board size never scales placements
// (positions are absolute).
export interface BoardPanelProps {
  readonly board: Board;
  readonly selected: Placement | null;
  readonly onTitleChange: (title: string) => void;
  readonly onNotesChange: (notes: string) => void;
  readonly onSizeChange: (size: BoardSize) => void;
  readonly onBackgroundChange: (background: BoardBackground) => void;
}

const BG_LABEL = {
  ink: moodboardMessages.bgInk,
  paper: moodboardMessages.bgPaper,
  sepia: moodboardMessages.bgSepia,
  navy: moodboardMessages.bgNavy,
} as const;

export function BoardPanel({
  board,
  selected,
  onTitleChange,
  onNotesChange,
  onSizeChange,
  onBackgroundChange,
}: BoardPanelProps): ReactElement {
  const intl = useIntl();
  const sizeValue = `${board.size.width}×${board.size.height}`;
  const selectedSummary = selected === null ? '' : `${selected.w}×${selected.h} · ${selected.rotation}°`;
  const onSize = (event: ChangeEvent<HTMLSelectElement>): void => {
    const preset = BOARD_SIZE_PRESETS.find((option) => `${option.size.width}×${option.size.height}` === event.target.value);
    if (preset !== undefined) onSizeChange(preset.size);
  };

  return (
    <section className="ovl-moodboard__panel" aria-label={intl.formatMessage(moodboardMessages.panelBoard)}>
      <div className="ovl-moodboard__panel-heading">
        <FormattedMessage {...moodboardMessages.panelBoard} />
      </div>
      <div className="ovl-moodboard__field">
        <label htmlFor="ovl-board-title">
          <FormattedMessage {...moodboardMessages.fieldTitle} />
        </label>
        <input id="ovl-board-title" type="text" value={board.title} onChange={(event) => onTitleChange(event.target.value)} />
      </div>
      <div className="ovl-moodboard__field">
        <label htmlFor="ovl-board-notes">
          <FormattedMessage {...moodboardMessages.fieldNotes} />
        </label>
        <textarea id="ovl-board-notes" rows={2} value={board.notes} onChange={(event) => onNotesChange(event.target.value)} />
      </div>
      <div className="ovl-moodboard__field">
        <label htmlFor="ovl-board-size">
          <FormattedMessage {...moodboardMessages.fieldSize} />
        </label>
        <select id="ovl-board-size" value={sizeValue} onChange={onSize}>
          {BOARD_SIZE_PRESETS.map((preset) => {
            const value = `${preset.size.width}×${preset.size.height}`;
            const optionLabel = `${preset.label} · ${value}`;
            return (
              <option key={preset.label} value={value}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      </div>
      <div className="ovl-moodboard__panel-row">
        <span>
          <FormattedMessage {...moodboardMessages.rowPlacements} />
        </span>
        <span className="mono-data">{board.placements.length}</span>
      </div>
      {selected === null ? null : (
        <div className="ovl-moodboard__panel-row">
          <span>
            <FormattedMessage {...moodboardMessages.rowSelected} />
          </span>
          <span className="mono-data">{selectedSummary}</span>
        </div>
      )}
      <div className="ovl-moodboard__panel-heading">
        <FormattedMessage {...moodboardMessages.panelBackground} />
      </div>
      <div className="ovl-moodboard__swatches">
        {BOARD_BACKGROUNDS.map((background) => (
          <button
            key={background}
            type="button"
            className="ovl-moodboard__swatch"
            data-bg={background}
            data-active={board.background === background}
            aria-pressed={board.background === background}
            aria-label={intl.formatMessage(moodboardMessages.background, { name: intl.formatMessage(BG_LABEL[background]) })}
            onClick={() => onBackgroundChange(background)}
          />
        ))}
      </div>
    </section>
  );
}
