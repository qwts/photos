import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactElement, type ReactNode } from 'react';

type AnnouncementPriority = 'polite' | 'assertive';

interface Announcement {
  readonly id: number;
  readonly text: string;
  readonly key?: string;
}

type AnnouncementAction = { readonly type: 'enqueue'; readonly announcement: Announcement } | { readonly type: 'next' };

interface AnnouncerValue {
  readonly announce: (text: string, priority?: AnnouncementPriority, key?: string) => void;
}

const AnnouncerContext = createContext<AnnouncerValue | null>(null);
const ANNOUNCEMENT_DWELL_MS = 1000;

function reducer(queue: readonly Announcement[], action: AnnouncementAction): readonly Announcement[] {
  if (action.type === 'next') return queue.slice(1);
  if (action.announcement.key === undefined) return [...queue, action.announcement];
  const existing = queue.findIndex((announcement) => announcement.key === action.announcement.key);
  return existing < 0
    ? [...queue, action.announcement]
    : queue.map((announcement, index) => (index === existing ? action.announcement : announcement));
}

function LiveRegion({
  queue,
  priority,
  onNext,
}: {
  readonly queue: readonly Announcement[];
  readonly priority: AnnouncementPriority;
  readonly onNext: () => void;
}): ReactElement {
  const active = queue[0];
  useEffect(() => {
    if (active === undefined) return;
    const timer = setTimeout(onNext, ANNOUNCEMENT_DWELL_MS);
    return () => clearTimeout(timer);
  }, [active, onNext]);
  return (
    <div
      className="ovl-live-region"
      data-testid={`screen-reader-announcer-${priority}`}
      role={priority === 'polite' ? 'status' : 'alert'}
      aria-live={priority}
      aria-atomic="true"
    >
      {active === undefined ? null : <span key={active.id}>{active.text}</span>}
    </div>
  );
}

export function AnnouncerProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [politeQueue, dispatchPolite] = useReducer(reducer, []);
  const [assertiveQueue, dispatchAssertive] = useReducer(reducer, []);
  const nextId = useRef(0);
  const announce = useCallback((text: string, priority: AnnouncementPriority = 'polite', key?: string): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    nextId.current += 1;
    const action: AnnouncementAction = {
      type: 'enqueue',
      announcement: { id: nextId.current, text: trimmed, ...(key === undefined ? {} : { key }) },
    };
    if (priority === 'assertive') dispatchAssertive(action);
    else dispatchPolite(action);
  }, []);
  const value = useMemo(() => ({ announce }), [announce]);
  const nextPolite = useCallback(() => dispatchPolite({ type: 'next' }), []);
  const nextAssertive = useCallback(() => dispatchAssertive({ type: 'next' }), []);
  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <LiveRegion queue={politeQueue} priority="polite" onNext={nextPolite} />
      <LiveRegion queue={assertiveQueue} priority="assertive" onNext={nextAssertive} />
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): AnnouncerValue {
  const value = useContext(AnnouncerContext);
  if (value === null) throw new Error('useAnnouncer requires AnnouncerProvider');
  return value;
}
