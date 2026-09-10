
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const LESSOPEN: string;
	export const LESS_TERMCAP_se: string;
	export const ZELLIJ_SESSION_NAME: string;
	export const CLAUDE_CODE_BRIDGE_OWNER_ORG_UUID: string;
	export const HTTPS_PROXY: string;
	export const RSYNC_PROXY: string;
	export const LESS_TERMCAP_ue: string;
	export const SSH_CLIENT: string;
	export const USER: string;
	export const AI_AGENT: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const SANDBOX_RUNTIME: string;
	export const no_proxy: string;
	export const GIT_SSH_COMMAND: string;
	export const npm_config_user_agent: string;
	export const GIT_EDITOR: string;
	export const all_proxy: string;
	export const CLOUDSDK_PROXY_USERNAME: string;
	export const CLAUDE_CODE_HOST_SOCKS_PROXY_PORT: string;
	export const BUN_INSTALL: string;
	export const XDG_SESSION_TYPE: string;
	export const DOCKER_HTTPS_PROXY: string;
	export const npm_node_execpath: string;
	export const GREP_COLOR: string;
	export const SHLVL: string;
	export const CLAUDE_CODE_MESSAGING_TOKEN: string;
	export const npm_config_noproxy: string;
	export const HOME: string;
	export const LESS: string;
	export const MOTD_SHOWN: string;
	export const OLDPWD: string;
	export const NVM_BIN: string;
	export const SSH_TTY: string;
	export const NO_PROXY: string;
	export const npm_package_json: string;
	export const NVM_INC: string;
	export const HOMEBREW_PREFIX: string;
	export const PAGER: string;
	export const ACCESS_KEY_ID: string;
	export const GREP_COLORS: string;
	export const LESS_TERMCAP_so: string;
	export const CLAUDE_CODE_CHILD_SESSION: string;
	export const npm_config_userconfig: string;
	export const npm_config_local_prefix: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const VISUAL: string;
	export const npm_config_engine_strict: string;
	export const COLORTERM: string;
	export const COLOR: string;
	export const NVM_DIR: string;
	export const npm_config_metrics_registry: string;
	export const INFOPATH: string;
	export const TMPDIR: string;
	export const https_proxy: string;
	export const CLAUDE_CODE_HOST_HTTP_PROXY_PORT: string;
	export const LOGNAME: string;
	export const ALL_PROXY: string;
	export const LESS_TERMCAP_us: string;
	export const _: string;
	export const http_proxy: string;
	export const npm_config_prefix: string;
	export const XDG_SESSION_CLASS: string;
	export const TERM: string;
	export const XDG_SESSION_ID: string;
	export const GIT_CONFIG_PARAMETERS: string;
	export const npm_config_cache: string;
	export const CLAUDE_CODE_ENVIRONMENT_KIND: string;
	export const TMPPREFIX: string;
	export const grpc_proxy: string;
	export const CLAUDE_CODE_BRIDGE_OWNER_ACCOUNT_UUID: string;
	export const npm_config_node_gyp: string;
	export const PATH: string;
	export const HOMEBREW_CELLAR: string;
	export const S3_ENDPOINT: string;
	export const CLAUDE_CODE_TMPDIR: string;
	export const NODE: string;
	export const npm_package_name: string;
	export const XDG_RUNTIME_DIR: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const CLAUDE_CODE_SESSION_ACCESS_TOKEN: string;
	export const ftp_proxy: string;
	export const CLOUDSDK_PROXY_PASSWORD: string;
	export const CLAUDE_EFFORT: string;
	export const LANG: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const CLAUDE_PID: string;
	export const LS_COLORS: string;
	export const ZELLIJ_PANE_ID: string;
	export const CLAUDE_CODE_WORKER_EPOCH: string;
	export const npm_lifecycle_script: string;
	export const SECRET_ACCESS_KEY: string;
	export const ZELLIJ: string;
	export const SHELL: string;
	export const npm_package_version: string;
	export const npm_lifecycle_event: string;
	export const NODE_PATH: string;
	export const CLAUDE_CODE_SESSION_ID: string;
	export const CLOUDSDK_PROXY_TYPE: string;
	export const LESS_TERMCAP_mb: string;
	export const CLAUDECODE: string;
	export const CLOUDSDK_PROXY_ADDRESS: string;
	export const LESS_TERMCAP_md: string;
	export const CLOUDSDK_PROXY_PORT: string;
	export const npm_config_globalconfig: string;
	export const npm_config_init_module: string;
	export const LESS_TERMCAP_me: string;
	export const PWD: string;
	export const CLAUDE_TMPDIR: string;
	export const npm_execpath: string;
	export const NVM_CD_FLAGS: string;
	export const SSH_CONNECTION: string;
	export const CLAUDE_CODE_EXECPATH: string;
	export const FTP_PROXY: string;
	export const npm_config_global_prefix: string;
	export const HOMEBREW_REPOSITORY: string;
	export const HTTP_PROXY: string;
	export const npm_command: string;
	export const PNPM_HOME: string;
	export const CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: string;
	export const EDITOR: string;
	export const CLAUDE_CODE_MESSAGING_SOCKET: string;
	export const GRPC_PROXY: string;
	export const DOCKER_HTTP_PROXY: string;
	export const INIT_CWD: string;
	export const TEST: string;
	export const VITEST: string;
	export const NODE_ENV: string;
	export const PROD: string;
	export const DEV: string;
	export const BASE_URL: string;
	export const MODE: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		LESSOPEN: string;
		LESS_TERMCAP_se: string;
		ZELLIJ_SESSION_NAME: string;
		CLAUDE_CODE_BRIDGE_OWNER_ORG_UUID: string;
		HTTPS_PROXY: string;
		RSYNC_PROXY: string;
		LESS_TERMCAP_ue: string;
		SSH_CLIENT: string;
		USER: string;
		AI_AGENT: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		SANDBOX_RUNTIME: string;
		no_proxy: string;
		GIT_SSH_COMMAND: string;
		npm_config_user_agent: string;
		GIT_EDITOR: string;
		all_proxy: string;
		CLOUDSDK_PROXY_USERNAME: string;
		CLAUDE_CODE_HOST_SOCKS_PROXY_PORT: string;
		BUN_INSTALL: string;
		XDG_SESSION_TYPE: string;
		DOCKER_HTTPS_PROXY: string;
		npm_node_execpath: string;
		GREP_COLOR: string;
		SHLVL: string;
		CLAUDE_CODE_MESSAGING_TOKEN: string;
		npm_config_noproxy: string;
		HOME: string;
		LESS: string;
		MOTD_SHOWN: string;
		OLDPWD: string;
		NVM_BIN: string;
		SSH_TTY: string;
		NO_PROXY: string;
		npm_package_json: string;
		NVM_INC: string;
		HOMEBREW_PREFIX: string;
		PAGER: string;
		ACCESS_KEY_ID: string;
		GREP_COLORS: string;
		LESS_TERMCAP_so: string;
		CLAUDE_CODE_CHILD_SESSION: string;
		npm_config_userconfig: string;
		npm_config_local_prefix: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		VISUAL: string;
		npm_config_engine_strict: string;
		COLORTERM: string;
		COLOR: string;
		NVM_DIR: string;
		npm_config_metrics_registry: string;
		INFOPATH: string;
		TMPDIR: string;
		https_proxy: string;
		CLAUDE_CODE_HOST_HTTP_PROXY_PORT: string;
		LOGNAME: string;
		ALL_PROXY: string;
		LESS_TERMCAP_us: string;
		_: string;
		http_proxy: string;
		npm_config_prefix: string;
		XDG_SESSION_CLASS: string;
		TERM: string;
		XDG_SESSION_ID: string;
		GIT_CONFIG_PARAMETERS: string;
		npm_config_cache: string;
		CLAUDE_CODE_ENVIRONMENT_KIND: string;
		TMPPREFIX: string;
		grpc_proxy: string;
		CLAUDE_CODE_BRIDGE_OWNER_ACCOUNT_UUID: string;
		npm_config_node_gyp: string;
		PATH: string;
		HOMEBREW_CELLAR: string;
		S3_ENDPOINT: string;
		CLAUDE_CODE_TMPDIR: string;
		NODE: string;
		npm_package_name: string;
		XDG_RUNTIME_DIR: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		CLAUDE_CODE_SESSION_ACCESS_TOKEN: string;
		ftp_proxy: string;
		CLOUDSDK_PROXY_PASSWORD: string;
		CLAUDE_EFFORT: string;
		LANG: string;
		NoDefaultCurrentDirectoryInExePath: string;
		CLAUDE_PID: string;
		LS_COLORS: string;
		ZELLIJ_PANE_ID: string;
		CLAUDE_CODE_WORKER_EPOCH: string;
		npm_lifecycle_script: string;
		SECRET_ACCESS_KEY: string;
		ZELLIJ: string;
		SHELL: string;
		npm_package_version: string;
		npm_lifecycle_event: string;
		NODE_PATH: string;
		CLAUDE_CODE_SESSION_ID: string;
		CLOUDSDK_PROXY_TYPE: string;
		LESS_TERMCAP_mb: string;
		CLAUDECODE: string;
		CLOUDSDK_PROXY_ADDRESS: string;
		LESS_TERMCAP_md: string;
		CLOUDSDK_PROXY_PORT: string;
		npm_config_globalconfig: string;
		npm_config_init_module: string;
		LESS_TERMCAP_me: string;
		PWD: string;
		CLAUDE_TMPDIR: string;
		npm_execpath: string;
		NVM_CD_FLAGS: string;
		SSH_CONNECTION: string;
		CLAUDE_CODE_EXECPATH: string;
		FTP_PROXY: string;
		npm_config_global_prefix: string;
		HOMEBREW_REPOSITORY: string;
		HTTP_PROXY: string;
		npm_command: string;
		PNPM_HOME: string;
		CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: string;
		EDITOR: string;
		CLAUDE_CODE_MESSAGING_SOCKET: string;
		GRPC_PROXY: string;
		DOCKER_HTTP_PROXY: string;
		INIT_CWD: string;
		TEST: string;
		VITEST: string;
		NODE_ENV: string;
		PROD: string;
		DEV: string;
		BASE_URL: string;
		MODE: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
