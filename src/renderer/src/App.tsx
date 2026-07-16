import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import './app.css';
import { AppStateProvider } from './state/app-state-context';
import { Shell } from './shell/Shell';
import { RestoreOnboarding } from './restore/RestoreOnboarding';
import { LockScreen } from './lock/LockScreen';

type LockStatus = Awaited<ReturnType<typeof window.overlook.appLock.status>>;

// App root (#73): platform lookup + state provider around the composed
// shell. The token specimen moved to Storybook-only duty with this change.
export function App(): ReactElement {
  // Until the platform round-trip resolves, render the mac variant: it draws
  // no controls, so a wrong first frame on win/linux flashes nothing broken.
  const [platform, setPlatform] = useState('darwin');
  const [fresh, setFresh] = useState<boolean | null>(null);
  const [lock, setLock] = useState<LockStatus | null>(null);
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

  if (lock === null) return <></>;
  if (lock.state !== 'unconfigured-unlocked' && lock.state !== 'unlocked') {
    return <LockScreen platform={platform} state={lock.state} retryAfterMs={lock.retryAfterMs} />;
  }

  return (
    <AppStateProvider>
      {fresh === true ? (
        <RestoreOnboarding platform={platform} onStartNew={() => setFresh(false)} />
      ) : fresh === false ? (
        <Shell platform={platform} lockConfigured={lock.state === 'unlocked'} />
      ) : null}
    </AppStateProvider>
  );
}
