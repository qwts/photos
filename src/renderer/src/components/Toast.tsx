import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

import './overlays.css';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'neutral' | 'green' | 'amber' | 'red';

const TONES: Record<ToastTone, { icon: IconName; color: string }> = {
  neutral: { icon: 'info', color: 'var(--text-muted)' },
  green: { icon: 'shield-check', color: 'var(--accent-green)' },
  amber: { icon: 'cloud-upload', color: 'var(--accent-amber)' },
  red: { icon: 'triangle-alert', color: 'var(--accent-red)' },
};

export interface ToastProps {
  readonly tone?: ToastTone;
  readonly icon?: IconName;
  readonly title: string;
  readonly detail?: string;
  readonly action?: ReactNode;
}

// feedback/Toast.jsx + aria-live (#59): role=status announces politely.
export function Toast({ tone = 'neutral', icon, title, detail, action }: ToastProps): ReactElement {
  const t = TONES[tone];
  return (
    <div role="status" className="ovl-toast">
      <Icon name={icon ?? t.icon} size={16} color={t.color} />
      <div className="ovl-toast__content">
        <div className="ovl-toast__title">{title}</div>
        {detail === undefined ? null : <div className="ovl-toast__detail">{detail}</div>}
      </div>
      {action}
    </div>
  );
}

export interface ToastItem extends ToastProps {
  readonly id: string;
}

export interface ToastHostProps {
  readonly toasts: readonly ToastItem[];
  readonly onDismiss: (id: string) => void;
  /** 4s per the design; stories inject a short value to test dismissal. */
  readonly autoDismissMs?: number;
}

function ToastTimer({
  toast,
  onDismiss,
  autoDismissMs,
}: {
  readonly toast: ToastItem;
  readonly onDismiss: (id: string) => void;
  readonly autoDismissMs: number;
}): ReactElement {
  // The timer is keyed to the toast, not the callback: parents passing inline
  // onDismiss rerender freely without resetting (and so extending) the 4s
  // lifetime — the latest callback is read through a ref at fire time.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismissRef.current(toast.id);
    }, autoDismissMs);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, autoDismissMs]);
  return <Toast {...toast} />;
}

// Bottom-right stack; each toast dismisses itself after autoDismissMs.
export function ToastHost({ toasts, onDismiss, autoDismissMs = 4000 }: ToastHostProps): ReactElement {
  return (
    <div className="ovl-toast-host">
      {toasts.map((toast) => (
        <ToastTimer key={toast.id} toast={toast} onDismiss={onDismiss} autoDismissMs={autoDismissMs} />
      ))}
    </div>
  );
}
