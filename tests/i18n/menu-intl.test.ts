import assert from 'node:assert/strict';
import test from 'node:test';

import { createMenuTranslator } from '../../src/main/i18n/menu-intl.js';

test('main menu translator formats the shared command catalog (#531)', () => {
  const translate = createMenuTranslator('en');

  assert.equal(translate({ id: 'commands.app.settings.open', defaultMessage: 'fallback' }), 'Settings…');
});

test('main menu translator falls back to source locale and descriptor text (#531)', () => {
  const translate = createMenuTranslator('zz-ZZ');

  assert.equal(translate({ id: 'commands.help.open', defaultMessage: 'fallback' }), 'Overlook Help');
  assert.equal(translate({ id: 'commands.unknown', defaultMessage: 'Unknown command' }), 'Unknown command');
});
