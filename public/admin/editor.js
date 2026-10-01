/* Configuration is public; authentication secrets belong only in Netlify. */
(() => {
  'use strict';
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const requestedDemo = new URLSearchParams(location.search).get('demo') === '1';
  const card = document.getElementById('editor-status');
  const message = document.getElementById('status-message');
  const help = document.getElementById('setup-help');
  document.getElementById('demo-link').hidden = !local;
  const fail = text => { card.hidden = false; message.textContent = text; help.hidden = false; };
  const loadScript = source => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    const timer = setTimeout(() => reject(new Error('The editor download timed out. Reload the page to try again.')), 20000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('The editor bundle could not be loaded. Check that the site includes its admin/vendor files, then reload.')); };
    document.head.append(script);
  });
  async function start() {
    if (requestedDemo && !local) throw new Error('The temporary editor preview is available only on localhost. Use the configured GitHub editor on the published site.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(requestedDemo ? './demo-config.json' : './config.yml', {cache:'no-store', signal:controller.signal});
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error('Shared editing is not connected yet. The site owner needs to complete the one-time setup.');
    // The generated .yml is JSON (a valid YAML subset), so no second parser is needed.
    const config = await response.json();
    if (!requestedDemo && (config.backend?.name !== 'github' ||
        !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(config.backend?.repo || '') ||
        !/^https:\/\//.test(config.site_url || '') ||
        JSON.stringify(config).includes('__GITHUB_REPOSITORY__') || JSON.stringify(config).includes('__SITE_URL__'))) {
      throw new Error('Shared editing is not configured yet. Set the repository and live site address, then rebuild.');
    }
    if (requestedDemo && config.backend?.name !== 'test-repo') throw new Error('Local preview configuration is invalid.');
    window.CMS_MANUAL_INIT = true;
    message.textContent = 'Opening the editor…';
    await loadScript('./vendor/decap-cms-3.15.1.js');
    if (!window.CMS?.init) throw new Error('The editor did not initialize. Reload the page or check the bundled Decap CMS file.');
    config.load_config_file = false;
    window.CMS.init({config});
    card.hidden = true;
    if (requestedDemo) {
      document.body.classList.add('preview-mode');
      document.getElementById('preview-notice').hidden = false;
    }
  }
  start().catch(error => fail(error.name === 'AbortError' ? 'The configuration request timed out. Reload the page to try again.' : error instanceof SyntaxError ? 'The editor configuration could not be read. Check the generated config file.' : error.message));
})();
