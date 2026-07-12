import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import './app.css';
import { AppStateProvider } from './state/app-state-context';
import { Shell } from './shell/Shell';

// App root (#73): platform lookup + state provider around the composed
// shell. The token specimen moved to Storybook-only duty with this change.
export function App(): ReactElement {
  // Until the platform round-trip resolves, render the mac variant: it draws
  // no controls, so a wrong first frame on win/linux flashes nothing broken.
  const [platform, setPlatform] = useState('darwin');
  useEffect(() => {
    void window.overlook.getPlatform().then(setPlatform);
  }, []);

  return (
    <AppStateProvider>
      <Shell platform={platform} />
    </AppStateProvider>
  );
}
