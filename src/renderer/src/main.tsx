import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/index.css';
import { App } from './App';
import { IntlHost } from './i18n/IntlHost';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Renderer root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <IntlHost>
      <App />
    </IntlHost>
  </StrictMode>,
);
