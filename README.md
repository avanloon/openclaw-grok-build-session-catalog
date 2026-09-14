# Grok Build Session Catalog

An opt-in, read-only OpenClaw plugin that surfaces local Grok Build sessions from
`~/.grok/sessions` in the OpenClaw session catalog.

## Safety boundary

- Reads only the local Grok session store.
- Does not call xAI or require API credentials.
- Never exposes stored system prompts.
- Does not resume, archive, edit, or delete Grok sessions.

## Install

```bash
openclaw plugins install clawhub:openclaw-grok-build-session-catalog
openclaw plugins enable grok-build-session-catalog
openclaw config set plugins.entries.grok-build-session-catalog.config.enabled true
```

Restart the Gateway, then open Sessions and select **Grok Build**.

## Local proof

```bash
npm install
npm test
npm run validate
npm pack --dry-run
```

This OpenClaw feature plugin includes a typed draft-analysis operation, a model tool, a native page, and a composer replacement. The browser entry owns its DOM and uses the host's canonical draft and send operations.

## Build and install

```sh
npm install
npm run build
npm run validate
openclaw plugins install .
openclaw gateway restart
```

For native UI, enable **Settings > Labs > Custom plugin UI** (`gateway.controlUi.experimental.customPlugins: true`), then restart the Gateway and reload the browser tab. This setting is off by default; backend installation does not require it.

Select Grok Build Session Catalog in the Control UI sidebar. Open **Plugins > Customize UI** and choose Draft composer to try the replacement; choose Built-in to restore it.

For agent-requested activation, run `npm run pack`. The receipt contains the exact archive path and SHA-256 digest for `plugin_activate_artifact`. Approval applies to those bundled bytes and does not enable Custom plugin UI. The archive has no install scripts or package dependencies; backend activation still requires a Gateway restart.

After browser-only changes, run the build again and use **Plugins > Customize UI > Reload plugin UI** as an administrator. Backend changes require the normal plugin update and Gateway restart. Native plugins run trusted code in the Gateway and browser; install only code you trust.

Keep browser imports on the browser-safe `control-ui` and `feature-contract` SDK entrypoints. Bundle framework dependencies with the plugin. Return a dispose handle for DOM, subscriptions, and other resources; check the view's abort signal after asynchronous work.
