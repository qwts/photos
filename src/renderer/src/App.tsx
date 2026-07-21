import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import './app.css';
import { AppStateProvider } from './state/app-state-context';
import { Shell } from './shell/Shell';
import { RestoreOnboarding } from './restore/RestoreOnboarding';
import { LockScreen } from './lock/LockScreen';
import { EMPTY_COMMAND_MENU_CONTEXT } from '../../shared/commands/menu-contract.js';
import type { CommandId } from '../../shared/commands/registry.js';
import { AnnouncerProvider } from './components/LiveAnnouncer';

type LockStatus = Awaited<ReturnType<typeof window.overlook.appLock.status>>;

// App root (#73): platform lookup + state provider around the composed
// shell. The token specimen moved to Storybook-only duty with this change.
export function App(): ReactElement {
  // Until the platform round-trip resolves, render the mac variant: it draws
  // no controls, so a wrong first frame on win/linux flashes nothing broken.
  const [platform, setPlatform] = useState('darwin');
  const [fresh, setFresh] = useState<boolean | null>(null);
  const [lock, setLock] = useState<LockStatus | null>(null);
  const [nativeCommand, setNativeCommand] = useState<{ readonly id: CommandId; readonly sequence: number } | null>(null);
  const sequenceRef = useRef(0);
  useEffect(() => {
    const unsubscribe = window.overlook.commands.onInvoked(({ id }) => {
      sequenceRef.current += 1;
      setNativeCommand({ id, sequence: sequenceRef.current });
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    void window.overlook.getPlatform().then(setPlatform);
    void window.overlook.appLock.status().then(setLock);
    return window.overlook.appLock.onChanged(setLock);
  }, []);

  useEffect(() => {
    if (lock?.state === 'unconfigured-unlocked' || lock?.state === 'unlocked') {
      void window.overlook.restore.profileStatus().then(({ fresh: value }) => setFresh(value));
    }
  }, [lock?.state]);

  useEffect(() => {
    if (lock === null) return;
    const authorized = lock.state === 'unconfigured-unlocked' || lock.state === 'unlocked';
    const context = {
      ...EMPTY_COMMAND_MENU_CONTEXT,
      surface: authorized ? ('onboarding' as const) : ('locked' as const),
      hasLibrary: lock.libraryId !== null,
      appLockConfigured: lock.state !== 'unconfigured-unlocked',
    };
    void window.overlook.commands.ready(context);
  }, [lock]);

  if (lock === null) return <></>;
  if (lock.state !== 'unconfigured-unlocked' && lock.state !== 'unlocked') {
    return (
      <AnnouncerProvider>
        <LockScreen platform={platform} state={lock.state} retryAfterMs={lock.retryAfterMs} />
      </AnnouncerProvider>
    );
  }

  return (
    <AnnouncerProvider>
      <AppStateProvider>
        {fresh === true ? (
          <RestoreOnboarding platform={platform} onStartNew={() => setFresh(false)} />
        ) : fresh === false ? (
          <Shell platform={platform} lockConfigured={lock.state === 'unlocked'} nativeCommand={nativeCommand} />
        ) : null}
      </AppStateProvider>
    </AnnouncerProvider>
  );
}
