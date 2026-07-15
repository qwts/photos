import type { ReactElement } from 'react';

import { TitleBar } from '../components/TitleBar';
import { RestoreWorkflow } from './RestoreWorkflow';

export function RestoreOnboarding({ platform, onStartNew }: { readonly platform: string; readonly onStartNew: () => void }): ReactElement {
  return (
    <div className="ovl-restoreOnboarding" data-testid="restore-onboarding">
      <TitleBar
        platform={platform}
        onMinimize={() => void window.overlook.minimizeWindow()}
        onToggleMaximize={() => void window.overlook.toggleMaximizeWindow()}
        onClose={() => void window.overlook.closeWindow()}
      />
      <main className="ovl-restoreOnboarding__main">
        <section className="ovl-restoreOnboarding__card" aria-label="Cloud library recovery">
          <RestoreWorkflow context="onboarding" onStartNew={onStartNew} />
        </section>
      </main>
    </div>
  );
}
