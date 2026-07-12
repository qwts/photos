import type { ReactElement } from 'react';

import './app.css';

// Shell placeholder — the design-system components and real app chrome arrive
// with M02+. The drag region is the frameless-window contract from #50; the
// styled TitleBar replaces it in M02.
export function App(): ReactElement {
  return (
    <>
      <div className="titlebar-drag-region" />
      <p>Overlook — shell placeholder</p>
    </>
  );
}
