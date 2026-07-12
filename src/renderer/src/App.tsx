import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import './app.css';
import { TitleBar } from './components/TitleBar';
import { TokenSpecimen } from './TokenSpecimen';

// Shell: real TitleBar chrome (#58) over the token specimen placeholder —
// the remaining app chrome (Toolbar, Sidebar, StatusBar) arrives with M04+.
export function App(): ReactElement {
  // Until the platform round-trip resolves, render the mac variant: it draws
  // no controls, so a wrong first frame on win/linux flashes nothing broken.
  const [platform, setPlatform] = useState('darwin');
  useEffect(() => {
    void window.overlook.getPlatform().then(setPlatform);
  }, []);

  return (
    <div className="app-shell">
      <TitleBar
        platform={platform}
        onMinimize={() => {
          void window.overlook.minimizeWindow();
        }}
        onToggleMaximize={() => {
          void window.overlook.toggleMaximizeWindow();
        }}
        onClose={() => {
          void window.overlook.closeWindow();
        }}
      />
      <main className="app-shell__content">
        <TokenSpecimen />
      </main>
    </div>
  );
}
