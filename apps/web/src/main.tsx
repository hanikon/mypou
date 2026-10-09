import { render } from 'preact';
import { APP_CONFIG } from '@kaplya/shared';
import { App } from './App';
import { lang } from './i18n';
import { initTelegram } from './telegram';
import './styles.css';

initTelegram((scheme) => {
  document.documentElement.dataset.theme = scheme;
});
document.documentElement.lang = lang.value;
document.title = APP_CONFIG.name[lang.value];

render(<App />, document.getElementById('app')!);
