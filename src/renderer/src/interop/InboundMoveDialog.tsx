import { useEffect, useState, type ReactElement } from 'react';

import type { InteropInboundStatus } from '../../../shared/interop/inbound-ui.js';
import { InteropWorkflowDialog } from './InteropWorkflowDialog.js';
import { blockedInteropWorkflow, visibleInboundWorkflow } from './visible-workflow.js';

export function InboundMoveDialog({ onClose }: { readonly onClose: () => void }): ReactElement {
  const [status, setStatus] = useState<InteropInboundStatus | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.overlook.interop.onChanged((next) => {
      if (active) setStatus(next);
    });
    void window.overlook.interop.status().then(async (initial) => {
      if (!active) return;
      setStatus(initial);
      if (initial.provider.status === 'connected' && initial.pairing.status === 'unlocked') {
        setStatus(await window.overlook.interop.refresh());
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const state = status === null ? blockedInteropWorkflow('settings', 0) : visibleInboundWorkflow(status);
  const selectedTransferId = status?.selectedTransferId ?? null;
  return (
    <InteropWorkflowDialog
      state={state}
      onClose={onClose}
      onStart={
        selectedTransferId === null
          ? undefined
          : () => {
              void window.overlook.interop.start({ transferId: selectedTransferId }).then(setStatus);
            }
      }
      onPause={() => void window.overlook.interop.pause().then(setStatus)}
      onResume={() => void window.overlook.interop.resume().then(setStatus)}
      onCancel={() => void window.overlook.interop.cancel().then(setStatus)}
      onRetry={() => void window.overlook.interop.retry().then(setStatus)}
      onReconnect={() => void window.overlook.interop.connectProvider({ provider: 'pcloud' }).then(setStatus)}
      onDisconnect={() => void window.overlook.interop.disconnectProvider({ provider: 'pcloud' }).then(setStatus)}
    />
  );
}
