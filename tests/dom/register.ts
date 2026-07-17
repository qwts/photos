import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { register } from 'node:module';

register('./css-loader.js', import.meta.url);
GlobalRegistrator.register();

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
