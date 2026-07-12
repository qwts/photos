import type { ReactElement } from 'react';

import './app.css';
import { TokenSpecimen } from './TokenSpecimen';

// Shell placeholder — real app chrome arrives with the M02 components. The
// drag region is the frameless-window contract from #50; the token specimen
// keeps the styling foundation verifiable until Storybook (#56).
export function App(): ReactElement {
  return (
    <>
      <div className="titlebar-drag-region" />
      <TokenSpecimen />
    </>
  );
}
